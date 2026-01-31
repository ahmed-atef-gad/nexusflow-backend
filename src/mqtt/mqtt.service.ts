import { Injectable, Inject, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class MqttService {
  private readonly logger = new Logger(MqttService.name);

  constructor(@Inject('MQTT_CLIENT') private client: ClientProxy) {}

  /**
   * Publish a message to a specific topic
   * @param topic The MQTT topic (e.g., 'device/123/command')
   * @param payload The data to send (string or object)
   */
  publish(topic: string, payload: any) {
    this.logger.log(`Publishing to ${topic}: ${JSON.stringify(payload)}`);
    // .emit() sends a message without waiting for a response (Fire-and-forget)
    return this.client.emit(topic, payload);
  }

  /**
   * Send a message and wait for a response (Request-Response pattern)
   * Requires the device to reply on a specific reply topic
   */
  send(topic: string, payload: any) {
    return this.client.send(topic, payload);
  }
}
