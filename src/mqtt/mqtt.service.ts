import { Injectable, Logger } from '@nestjs/common';
import { PigeonService } from '../pigeon-mqtt/pigeon.service';

type PublishOptions = {
  qos?: 0 | 1 | 2;
  retain?: boolean;
};

@Injectable()
export class MqttService {
  private readonly logger = new Logger(MqttService.name);

  constructor(private readonly pigeonService: PigeonService) {}

  async publish(
    topic: string,
    payload: unknown,
    options: PublishOptions = {},
  ) {
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
      { qos: 1, retain: false },
    );
  }
// flow id and its last update time
  async publishFlowLastUpdateChanged(
    flowId: string,
    lastUpdate: Date | string,
    topic = 'flows/lastupdate',
  ) {
    return this.publish(
      topic,
      {
        flowId,
        lastUpdate:
          lastUpdate instanceof Date ? lastUpdate.toISOString() : lastUpdate,
        message: `Flow ${flowId} has changed`,
      },
      { qos: 1, retain: true },
    );
  }
}
