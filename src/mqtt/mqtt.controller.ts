import { Controller, Get, Query } from '@nestjs/common';
import { MqttService } from './mqtt.service';

@Controller('mqtt')
export class MqttController {
  constructor(private readonly mqttService: MqttService) {}
/// test connection
  @Get('test')
  async testConnection(
    @Query('topic') topic = 'test/topic',
    @Query('message') message = 'Hello from NexusFlow backend',
  ) {
    await this.mqttService.publishMessage(topic, message);

    return {
      status: 'success',
      topic,
      message,
    };
  }
}
