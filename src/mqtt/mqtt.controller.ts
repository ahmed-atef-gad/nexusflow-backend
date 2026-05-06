import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../guards/auth/auth.guard';
import { RolesGuard } from '../guards/auth/roles.guard';
import { Role } from '../users/enums/role.enum';
import { MqttService } from './mqtt.service';
import type { NormalizedMqttConnections } from './mqtt.service';

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

  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get active MQTT user count (Admin)',
    description:
      'Returns the number of currently connected MQTT user clients (excluding devices). Admin only: accessible by Admin or Owner.',
  })
  @ApiOkResponse({
    description: 'Active MQTT user count fetched successfully',
    schema: {
      example: {
        connectedUsers: 3,
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing token',
  })
  @ApiForbiddenResponse({ description: 'Forbidden - Admin role required' })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @Get('active-users/count')
  getActiveUsersCount(): { connectedUsers: number } {
    return {
      connectedUsers: this.mqttService.getActiveUsersCount(),
    };
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get normalized active MQTT clients (Admin)',
    description:
      'Returns all currently connected MQTT clients grouped by user/owner, with user sessions and devices nested per user. Admin only: accessible by Admin or Owner.',
  })
  @ApiOkResponse({
    description: 'Normalized active MQTT clients fetched successfully',
    schema: {
      example: {
        totalConnectedClients: 3,
        totalConnectedUserClients: 2,
        totalConnectedDeviceClients: 1,
        totalUnclassifiedClients: 0,
        connectedUsers: [
          {
            userId: '699704d9e38e92c37878a54e',
            username: 'admin',
            userClientIds: ['admin-web', 'admin-mobile'],
            connectedUserClients: 2,
            devices: {
              connectedDeviceClients: 1,
              items: [
                {
                  deviceId: '65f4f8f30e5fa7c6d108f1d9',
                  deviceName: 'Kitchen Sensor',
                  macAddress: 'A1:B2:C3:D4:E5:B3',
                },
              ],
            },
          },
          {
            userId: 'unknown-owner',
            username: null,
            userClientIds: [],
            connectedUserClients: 0,
            devices: {
              connectedDeviceClients: 0,
              items: [],
            },
          },
        ],
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing token',
  })
  @ApiForbiddenResponse({ description: 'Forbidden - Admin role required' })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @Get('active-users')
  getActiveUsers(): NormalizedMqttConnections {
    return this.mqttService.getNormalizedActiveConnections();
  }
}
