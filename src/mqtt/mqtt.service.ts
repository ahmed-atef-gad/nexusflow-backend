import { Injectable, Logger } from '@nestjs/common';
import { PigeonService } from '../pigeon-mqtt/pigeon.service';
import { MQTT_TOPICS } from './mqtt.constants';

type PublishOptions = {
  qos?: 0 | 1 | 2;
  retain?: boolean;
};

type BrokerClient = {
  id?: string;
  userId?: string;
  mqttUsername?: string;
  isUserClient?: boolean;
  isEsp?: boolean;
  deviceMac?: string;
  deviceId?: string;
  deviceName?: string;
  ownerId?: string;
  ownerUsername?: string;
};

type BrokerClients = Map<string, BrokerClient> | Record<string, BrokerClient>;

type MqttBroker = {
  clients: BrokerClients;
};

export type ActiveMqttUser = {
  clientId: string;
  userId: string;
  username: string;
};

export type ConnectedOwnerDevice = {
  deviceId: string;
  deviceName: string | null;
  macAddress: string;
};

export type NormalizedConnectedUser = {
  userId: string;
  username: string | null;
  userClientIds: string[];
  connectedUserClients: number;
  devices: {
    connectedDeviceClients: number;
    items: ConnectedOwnerDevice[];
  };
};

export type NormalizedMqttConnections = {
  totalConnectedClients: number;
  totalConnectedUserClients: number;
  totalConnectedDeviceClients: number;
  totalUnclassifiedClients: number;
  connectedUsers: NormalizedConnectedUser[];
};

@Injectable()
export class MqttService {
  private readonly logger = new Logger(MqttService.name);

  constructor(private readonly pigeonService: PigeonService) {}

  private getBroker(): MqttBroker | null {
    const broker = this.pigeonService.getBrokerInstance() as
      | Partial<MqttBroker>
      | null
      | undefined;
    if (!broker?.clients) return null;

    if (broker.clients instanceof Map) {
      return { clients: broker.clients };
    }

    if (typeof broker.clients === 'object') {
      return { clients: broker.clients };
    }

    return null;
  }

  private getBrokerClientIds(): string[] {
    const broker = this.getBroker();
    if (!broker) return [];

    const { clients } = broker;
    if (clients instanceof Map) {
      return Array.from(clients.keys())
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim().toUpperCase());
    }

    return Object.keys(clients).map((id) => id.trim().toUpperCase());
  }

  private getBrokerClients(): BrokerClient[] {
    const broker = this.getBroker();
    if (!broker) return [];

    const { clients } = broker;
    if (clients instanceof Map) {
      return Array.from(clients.values());
    }

    return Object.values(clients);
  }

  async publish(
    topic: string,
    payload: unknown,
    options: PublishOptions = {}
  ): Promise<unknown> {
    const packet = {
      cmd: 'publish',
      topic,
      payload: Buffer.from(JSON.stringify(payload)),
      qos: options.qos ?? 1,
      retain: options.retain ?? false,
    };

    this.logger.log(`Publishing to topic: ${topic}`);
    return this.pigeonService.publish(packet) as Promise<unknown>;
  }

  async publishMessage(topic: string, message: string): Promise<unknown> {
    return this.publish(
      topic,
      {
        message,
        timestamp: new Date().toISOString(),
      },
      { qos: 1, retain: false }
    );
  }
  // flow id and its last update time
  async publishFlowLastUpdateChanged(
    macAddress: string,
    flowId: string,
    updatedAt: Date | string
  ): Promise<unknown> {
    const normalizedMac = macAddress.trim().toUpperCase();
    const topic = MQTT_TOPICS.FLOW_LAST_UPDATE(normalizedMac);
    const packet = {
      cmd: 'publish',
      topic,
      payload: Buffer.from(
        JSON.stringify({
          flow_id: flowId,
          clientId: macAddress,
          updatedAt:
            updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt,
        })
      ),
      qos: 1 as const,
      retain: false,
    };

    this.logger.log(
      `Publishing flow updated to topic: ${topic} as ${normalizedMac}`
    );
    return this.pigeonService.publish(packet) as Promise<unknown>;
  }

  async publishDeviceFlowChanged(
    macAddress: string,
    flowId: string,
    updatedAt: Date | string
  ): Promise<unknown> {
    const normalizedMac = macAddress.trim().toUpperCase();
    const topic = MQTT_TOPICS.DEVICE_FLOW_CHANGED(normalizedMac);
    const packet = {
      cmd: 'publish',
      topic,
      payload: Buffer.from(
        JSON.stringify({
          flow_id: flowId,
          clientId: macAddress,
          updatedAt:
            updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt,
        })
      ),
      qos: 1 as const,
      retain: false,
    };

    this.logger.log(
      `Publishing flow changed to topic: ${topic} as ${normalizedMac}`
    );
    return this.pigeonService.publish(packet) as Promise<unknown>;
  }

  isClientConnected(clientId: string): boolean {
    const normalizedClientId = clientId.trim().toUpperCase();
    return this.getBrokerClientIds().includes(normalizedClientId);
  }

  getActiveUserConnections(): ActiveMqttUser[] {
    const activeUsers = this.getBrokerClients()
      .filter((client) => {
        if (!client) return false;
        if (client.isEsp) return false;
        if (client.isUserClient === false) return false;
        return Boolean(client.userId && client.mqttUsername && client.id);
      })
      .map((client) => ({
        clientId: client.id as string,
        userId: client.userId as string,
        username: client.mqttUsername as string,
      }));

    return activeUsers.sort((a, b) => a.username.localeCompare(b.username));
  }

  getActiveUserSessionCount(userId: string): number {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) return 0;

    return this.getActiveUserConnections().filter(
      (client) => client.userId === normalizedUserId
    ).length;
  }

  getActiveUsersCount(): number {
    return this.getActiveUserConnections().length;
  }

  getNormalizedActiveConnections(): NormalizedMqttConnections {
    const brokerClients = this.getBrokerClients().filter((client) =>
      Boolean(client?.id)
    );

    const groupedOwners = new Map<
      string,
      {
        userId: string;
        username: string | null;
        userClientIds: Set<string>;
        devices: ConnectedOwnerDevice[];
      }
    >();

    let totalConnectedUserClients = 0;
    let totalConnectedDeviceClients = 0;
    let totalUnclassifiedClients = 0;

    brokerClients.forEach((client) => {
      const clientId = client.id as string;

      if (client.isUserClient && client.userId) {
        const username = client.mqttUsername ?? null;
        const existing = groupedOwners.get(client.userId);

        if (!existing) {
          groupedOwners.set(client.userId, {
            userId: client.userId,
            username,
            userClientIds: new Set([clientId]),
            devices: [],
          });
        } else {
          existing.userClientIds.add(clientId);
          if (!existing.username && username) {
            existing.username = username;
          }
        }

        totalConnectedUserClients += 1;
        return;
      }

      if (client.isEsp && client.deviceMac) {
        const ownerId = client.ownerId ?? 'unknown-owner';
        const existing = groupedOwners.get(ownerId);

        const resolvedDeviceId = client.deviceId ?? client.deviceMac;
        const deviceEntry: ConnectedOwnerDevice = {
          deviceId: resolvedDeviceId,
          deviceName: client.deviceName ?? null,
          macAddress: client.deviceMac,
        };

        if (!existing) {
          groupedOwners.set(ownerId, {
            userId: ownerId,
            username: client.ownerUsername ?? null,
            userClientIds: new Set<string>(),
            devices: [deviceEntry],
          });
        } else {
          existing.devices.push(deviceEntry);
          if (!existing.username && client.ownerUsername) {
            existing.username = client.ownerUsername;
          }
        }

        totalConnectedDeviceClients += 1;
        return;
      }

      totalUnclassifiedClients += 1;
    });

    const connectedUsers: NormalizedConnectedUser[] = Array.from(
      groupedOwners.values()
    )
      .map((ownerGroup) => {
        const userClientIds = Array.from(ownerGroup.userClientIds).sort(
          (a, b) => a.localeCompare(b)
        );
        const items = ownerGroup.devices.sort((a, b) =>
          a.macAddress.localeCompare(b.macAddress)
        );

        return {
          userId: ownerGroup.userId,
          username: ownerGroup.username,
          userClientIds,
          connectedUserClients: userClientIds.length,
          devices: {
            connectedDeviceClients: items.length,
            items,
          },
        };
      })
      .sort((a, b) => {
        const aName = a.username ?? a.userId;
        const bName = b.username ?? b.userId;
        return aName.localeCompare(bName);
      });

    return {
      totalConnectedClients: brokerClients.length,
      totalConnectedUserClients,
      totalConnectedDeviceClients,
      totalUnclassifiedClients,
      connectedUsers,
    };
  }
}
