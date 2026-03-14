import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { MqttService } from './mqtt.service';

@ApiTags('MQTT')
@Controller('mqtt')
export class MqttController {
  constructor(private readonly mqttService: MqttService) {}

  @ApiOperation({
    summary: 'Publish MQTT test message',
    description:
      'Publishes a test payload to the provided MQTT topic and returns what was sent.',
  })
  @ApiQuery({
    name: 'topic',
    required: false,
    description: 'MQTT topic to publish the message to',
    example: 'test/topic',
  })
  @ApiQuery({
    name: 'message',
    required: false,
    description: 'Text payload to publish',
    example: 'Hello from NexusFlow backend',
  })
  @ApiOkResponse({
    description: 'Message published successfully',
    schema: {
      example: {
        status: 'success',
        topic: 'test/topic',
        message: 'Hello from NexusFlow backend',
      },
    },
  })
  @Get('test')
  async testConnection(
    @Query('topic') topic = 'test/topic',
    @Query('message') message = 'Hello from NexusFlow backend'
  ) {
    await this.mqttService.publishMessage(topic, message);

    return {
      status: 'success',
      topic,
      message,
    };
  }
}
