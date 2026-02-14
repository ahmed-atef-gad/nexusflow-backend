import { Injectable, Logger } from '@nestjs/common';
import { PigeonService } from '../pigeon-mqtt/pigeon.service';
import { MQTT_TOPICS } from './mqtt.constants';

type PublishOptions = {
  qos?: 0 | 1 | 2;
  retain?: boolean;
};

@Injectable()
export class MqttService {
  private readonly logger = new Logger(MqttService.name);

  constructor(private readonly pigeonService: PigeonService) {}

  async publish(topic: string, payload: unknown, options: PublishOptions = {}) {
    const packet = {
      cmd: 'publish',
      topic,
      payload: Buffer.from(JSON.stringify(payload)),
      qos: options.qos ?? 1,
      retain: options.retain ?? false,
    };

    this.logger.log(`Publishing to topic: ${topic}`);
    return this.pigeonService.publish(packet);
  }

  async publishMessage(topic: string, message: string) {
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
    flowId: string,
    lastUpdate: Date | string,

    topic = MQTT_TOPICS.FLOWS_LAST_UPDATE
  ) {
    return this.publish(
      topic,
      {
        flowId,
        lastUpdate:
          lastUpdate instanceof Date ? lastUpdate.toISOString() : lastUpdate,
        message: `Flow ${flowId} has changed`,
      },
      { qos: 1, retain: true }
    );
  }

  async publishDeviceFlowChanged(
    macAddress: string,
    flowId: string,
    updatedAt: Date | string
  ) {
    const normalizedMac = macAddress.trim().toUpperCase();
    const topic = `/devices/${normalizedMac}/flowchanged`;
    const packet = {
      cmd: 'publish',
      topic,
      payload: Buffer.from(
        JSON.stringify({
          flow_id: flowId,
          client_id: macAddress,
          updatedAt:
            updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt,
        })
      ),
      qos: 1 as const,
      retain: true,
    };

    this.logger.log(
      `Publishing flow changed to topic: ${topic} as ${normalizedMac}`
    );
    return this.pigeonService.publish(packet);
    // const broker = this.pigeonService.getBrokerInstance();
    // return new Promise((resolve, reject) => {
    //   broker.publish(packet, { id: normalizedMac }, (error: Error | null) => {
    //     if (error) return reject(error);
    //     return resolve(packet);
    //   });
    // });
  }

  isClientConnected(clientId: string): boolean {
    const broker = this.pigeonService.getBrokerInstance();
    if (!broker) return false;

    const normalizedClientId = clientId.trim().toUpperCase();
    const clients = broker.clients;
    if (!clients) return false;

    if (typeof clients.get === 'function') {
      for (const [id] of clients as Iterable<[string, unknown]>) {
        if (id?.toString().trim().toUpperCase() === normalizedClientId) {
          return true;
        }
      }
      return false;
    }

    if (typeof clients === 'object') {
      return Object.keys(clients).some(
        (id) => id?.toString().trim().toUpperCase() === normalizedClientId
      );
    }

    return false;
  }
}
