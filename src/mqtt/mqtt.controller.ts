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
import { MqttPerformanceService } from './mqtt-performance.service';
import type { MqttPerformanceSession } from './mqtt-performance.service';

@ApiTags('MQTT')
@Controller('mqtt')
export class MqttController {
  constructor(
    private readonly mqttService: MqttService,
    private readonly mqttPerformanceService: MqttPerformanceService
  ) {}

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

  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get ESP MQTT performance metrics (Admin)',
    description:
      'Returns rolling in-memory latency and runtime logic timing metrics grouped by ESP MQTT session.',
  })
  @ApiOkResponse({
    description: 'ESP MQTT performance metrics fetched successfully',
    schema: {
      example: {
        activeSessions: [
          {
            sessionId: 'AA:BB:CC:DD:EE:FF:1778736712000',
            clientId: 'AA:BB:CC:DD:EE:FF',
            deviceMac: 'AA:BB:CC:DD:EE:FF',
            active: true,
            messages: {
              received: 120,
              withPublishedAt: 118,
              latency: {
                count: 118,
                avgMs: 32.41,
                minMs: 12.2,
                maxMs: 91.8,
                p95Ms: 70.5,
                lastMs: 29.3,
              },
            },
            logic: {
              pipelineRuns: 120,
              matchedPaths: 120,
              publishedCommands: 85,
              pipelineDuration: {
                count: 120,
                avgMs: 4.25,
                minMs: 1.01,
                maxMs: 14.9,
                p95Ms: 9.8,
                lastMs: 3.7,
              },
              pathDuration: {
                count: 120,
                avgMs: 2.9,
                minMs: 0.8,
                maxMs: 12.4,
                p95Ms: 7.1,
                lastMs: 2.2,
              },
            },
          },
        ],
        closedSessions: [],
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing token',
  })
  @ApiForbiddenResponse({ description: 'Forbidden - Admin role required' })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @Get('performance')
  getPerformance(): {
    activeSessions: MqttPerformanceSession[];
    closedSessions: MqttPerformanceSession[];
  } {
    return this.mqttPerformanceService.getSnapshot();
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get one ESP MQTT performance session (Admin)',
  })
  @ApiQuery({
    name: 'sessionId',
    required: true,
    description: 'Session ID returned by /mqtt/performance',
  })
  @ApiOkResponse({
    description: 'ESP MQTT performance session fetched successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing token',
  })
  @ApiForbiddenResponse({ description: 'Forbidden - Admin role required' })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @Get('performance/session')
  getPerformanceSession(
    @Query('sessionId') sessionId: string
  ): MqttPerformanceSession | null {
    return this.mqttPerformanceService.getSession(sessionId);
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get saved ESP MQTT performance sessions (Admin)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of saved sessions to return',
    example: 100,
  })
  @ApiOkResponse({
    description: 'Saved ESP MQTT performance sessions fetched successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing token',
  })
  @ApiForbiddenResponse({ description: 'Forbidden - Admin role required' })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @Get('performance/history')
  getPerformanceHistory(
    @Query('limit') limit?: string
  ): Promise<MqttPerformanceSession[]> {
    return this.mqttPerformanceService.getStoredSessions(Number(limit) || 100);
  }
}
