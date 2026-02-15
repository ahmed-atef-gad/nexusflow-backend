import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PigeonService } from '../pigeon-mqtt/pigeon.service';
import { DevicesService } from '../devices/devices.service';
import { UsersService } from '../users/users.service';
import { MqttService } from './mqtt.service';

@Injectable()
export class MqttHandlers implements OnModuleInit {
  private readonly logger = new Logger(MqttHandlers.name);

  constructor(
    private readonly pigeonService: PigeonService,
    private readonly devicesService: DevicesService,
    private readonly usersService: UsersService,
    private readonly mqttService: MqttService
  ) {}

  onModuleInit() {
    const broker = this.pigeonService.getBrokerInstance();
    broker.authenticate = this.onAuthenticate.bind(this);
    broker.authorizePublish = this.onAuthorizePublish.bind(this);
    broker.authorizeSubscribe = this.onAuthorizeSubscribe.bind(this);
    broker.authorizeForward = this.onAuthorizeForward.bind(this);
    broker.on('clientDisconnect', this.onClientDisconnect.bind(this));
    broker.on('publish', this.onClientPublish.bind(this));
  }

  private normalizeMacAddress(value: string): string {
    return value.trim().toUpperCase();
  }
  private normalizeUsername(value: string): string {
    return value.trim();
  }

  private isMacAddress(value: string): boolean {
    return /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(value.trim());
  }

  private isDevicesTopic(topic: string): boolean {
    return topic.startsWith('/devices') || topic.startsWith('devices/');
  }
  private extractDevicesTopicMac(topic: string): string | null {
    const segments = topic.split('/').filter(Boolean);
    if (segments.length < 2 || segments[0] !== 'devices') return null;
    if (segments[1] === '+' || segments[1] === '#') return null;
    return this.normalizeMacAddress(segments[1]);
  }

  private isAuthorizedForDevicesTopic(
    clientMac: string,
    topic: string
  ): boolean {
    const normalizedClientMac = this.normalizeMacAddress(clientMac);
    const topicMac = this.extractDevicesTopicMac(topic);
    return topicMac === normalizedClientMac;
  }

  private isAuthorizedDevicesSubscriptionFilter(
    clientMac: string,
    filter: string
  ): boolean {
    const normalizedClientMac = this.normalizeMacAddress(clientMac);
    const segments = (filter ?? '').split('/').filter(Boolean);

    // Allowed protected filter shape: /devices/{clientMac}/...
    if (segments.length < 2 || segments[0] !== 'devices') return false;
    if (segments[1] === '+' || segments[1] === '#') return false;

    const filterMac = this.normalizeMacAddress(segments[1]);
    return filterMac === normalizedClientMac;
  }

  private isUserAuthorizedForDevicesTopic(client: any, topic: string): boolean {
    const topicMac = this.extractDevicesTopicMac(topic);
    if (!topicMac) return false;

    const authorizedDeviceMacs = Array.isArray(client?.authorizedDeviceMacs)
      ? client.authorizedDeviceMacs
      : [];
    return authorizedDeviceMacs.includes(topicMac);
  }

  private rejectAuth(
    clientId: string,
    details: string,
    done: (error: Error | null, success?: boolean) => void
  ) {
    this.logger.warn(`MQTT auth rejected. clientId=${clientId} ${details}`);
    const error = new Error('Auth error') as Error & {
      returnCode?: number;
    };
    error.returnCode = 4;
    return done(error, false);
  }

  private async onAuthenticate(
    client: any,
    username: Buffer | string | undefined,
    password: Buffer | string | undefined,
    done: (error: Error | null, success?: boolean) => void
  ) {
    try {
      const mqttUsernameRaw = Buffer.isBuffer(username)
        ? username.toString()
        : (username ?? '').toString();
      const mqttPasswordRaw = Buffer.isBuffer(password)
        ? password.toString()
        : (password ?? '').toString();
      const mqttUsername = this.normalizeUsername(mqttUsernameRaw);
      const mqttPassword = mqttPasswordRaw.trim();
      const clientId = (client?.id ?? '').toString().trim();

      if (!clientId || !mqttPassword) {
        return this.rejectAuth(
          clientId || 'unknown',
          'reason=missing credentials',
          done
        );
      }

      // ESP path: if clientId is a MAC address, this is an ESP client.
      if (this.isMacAddress(clientId)) {
        const normalizedClientMac = this.normalizeMacAddress(clientId);

        if (
          mqttUsername &&
          this.normalizeMacAddress(mqttUsername) !== normalizedClientMac
        ) {
          return this.rejectAuth(
            clientId,
            `reason=username mismatch expectedMac=${normalizedClientMac}`,
            done
          );
        }

        const device = await this.devicesService.authenticateByMacAndPassword(
          normalizedClientMac,
          mqttPassword
        );

        if (!device || device.status === 'revoked') {
          return this.rejectAuth(
            clientId,
            `reason=invalid device credentials mac=${normalizedClientMac}`,
            done
          );
        }

        client.deviceMac = normalizedClientMac;
        client.isEsp = true;
        client.isUserClient = false;
        client.attributes = {
          ...(client.attributes ?? {}),
          esp: true,
          clientType: 'esp',
          macAddress: normalizedClientMac,
        };

        this.logger.log(
          `MQTT auth accepted. clientId=${clientId} type=esp mac=${normalizedClientMac}`
        );
        return done(null, true);
      }

      // // User path: mqtt clientId must match user username.
      // if (!mqttUsername || clientId !== mqttUsername) {
      //   return this.rejectAuth(
      //     clientId,
      //     `reason=clientId must equal mqtt username username=${mqttUsername || '(empty)'}`,
      //     done
      //   );
      // }

      const user = await this.usersService.authenticateMqttUser(
        mqttUsername,
        mqttPassword
      );
      if (!user || !user.is_active) {
        return this.rejectAuth(
          clientId,
          `reason=invalid user mqtt credentials username=${mqttUsername}`,
          done
        );
      }
      const userId = user.id || String((user as { _id?: unknown })._id ?? '');
      if (!userId) {
        return this.rejectAuth(
          clientId,
          `reason=invalid user id username=${mqttUsername}`,
          done
        );
      }

      const userDevices = await this.devicesService.findAllByUserId(userId);
      client.authorizedDeviceMacs = userDevices.map((device) =>
        this.normalizeMacAddress(device.macAddress)
      );
      client.isEsp = false;
      client.isUserClient = true;
      client.userId = userId;
      client.mqttUsername = user.username;
      client.attributes = {
        ...(client.attributes ?? {}),
        esp: false,
        clientType: 'user',
        username: user.username,
      };

      this.logger.log(
        `MQTT auth accepted. clientId=${clientId} type=user username=${user.username}`
      );
      return done(null, true);
    } catch (error) {
      this.logger.error(
        `MQTT auth failed with internal error. clientId=${client?.id ?? 'unknown'}`
      );
      return done(error as Error, false);
    }
  }

  private onAuthorizePublish(
    client: any,
    packet: { topic: string },
    done: (error: Error | null) => void
  ) {
    const topic = packet?.topic ?? '';

    if (!this.isDevicesTopic(topic)) {
      return done(null);
    }

    if (client?.isEsp) {
      const clientMac = client?.deviceMac;
      if (clientMac && this.isAuthorizedForDevicesTopic(clientMac, topic)) {
        return done(null);
      }
    }

    if (
      client?.isUserClient &&
      this.isUserAuthorizedForDevicesTopic(client, topic)
    ) {
      return done(null);
    }

    this.logger.warn(
      `MQTT publish rejected. clientId=${client?.id ?? 'unknown'} topic=${topic}`
    );
    return done(new Error('Not authorized'));
  }

  private onAuthorizeSubscribe(
    client: any,
    sub: { topic: string; qos?: 0 | 1 | 2 },
    done: (
      error: Error | null,
      granted?: { topic: string; qos?: 0 | 1 | 2 } | null
    ) => void
  ) {
    const topic = sub?.topic ?? '';

    // For /devices/* topics: allow wildcard subscriptions for ESP only.
    if (
      this.isDevicesTopic(topic) &&
      (topic.includes('#') || topic.includes('+'))
    ) {
      if (client?.isEsp) {
        return done(null, sub);
      }
      this.logger.warn(
        `MQTT subscribe rejected. clientId=${client?.id ?? 'unknown'} topic=${topic}`
      );
      return done(null, null);
    }

    // Allow wildcard filters on non-devices topics.
    if (topic.includes('#') || topic.includes('+')) {
      return done(null, sub);
    }

    // Enforce ownership for direct /devices/{mac}/... subscriptions.
    if (this.isDevicesTopic(topic)) {
      if (client?.isEsp) {
        const clientMac = client?.deviceMac;
        if (
          clientMac &&
          this.isAuthorizedDevicesSubscriptionFilter(clientMac, topic)
        ) {
          return done(null, sub);
        }
      }

      if (
        client?.isUserClient &&
        this.isUserAuthorizedForDevicesTopic(client, topic)
      ) {
        return done(null, sub);
      }

      this.logger.warn(
        `MQTT subscribe rejected. clientId=${client?.id ?? 'unknown'} topic=${topic}`
      );
      return done(null, null);
    }

    return done(null, sub);
  }

  private onAuthorizeForward(client: any, packet: { topic?: string }) {
    const topic = packet?.topic ?? '';
    if (!this.isDevicesTopic(topic)) return packet;

    if (client?.isEsp) {
      const clientMac = client?.deviceMac;
      if (clientMac && this.isAuthorizedForDevicesTopic(clientMac, topic)) {
        return packet;
      }
    }

    if (
      client?.isUserClient &&
      this.isUserAuthorizedForDevicesTopic(client, topic)
    ) {
      return packet;
    }

    this.logger.warn(
      `MQTT forward blocked. clientId=${client?.id ?? 'unknown'} topic=${topic}`
    );
    return null;
  }
  private async onClientDisconnect(client: any) {
    const clientId = client?.id?.toString?.() ?? '';
    if (clientId && client?.isEsp) {
      await this.mqttService.publish(`client/${clientId}/online`, {
        online: false,
        timestamp: new Date().toISOString(),
      });
      await this.devicesService.updateLastActiveByMacAddress(clientId);
    }
    this.logger.debug(`MQTT client disconnected. clientId=${clientId}`);
  }
  private onClientPublish(packet: any, client: any) {
    const topic = packet?.topic ?? '';
    const clientId = client?.id?.toString?.() ?? '';

    if (topic && clientId) {
      this.logger.debug(
        `MQTT message published. clientId=${clientId} topic=${topic}`
      );
    }
  }
}
