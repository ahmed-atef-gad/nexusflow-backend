import {
  Controller,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { UiService } from './ui.service';
import { DevicesService } from '../devices/devices.service';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiParam,
  ApiCookieAuth,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../gaurds/auth/auth.guard';
import { Ui } from './schemas/ui.schema';
import { IsOwner } from '../auth/decorators/owner.decorator';
import { OwnerGuard } from '../gaurds/auth/owner.guard';

@ApiTags('UI (User Interface)')
@ApiCookieAuth('jwt')
@UseGuards(AuthGuard, OwnerGuard)
@Controller('ui')
export class UiController {
  constructor(
    private readonly uiService: UiService,
    private readonly devicesService: DevicesService
  ) {}

  @ApiOperation({
    summary: 'Get UI configuration by flow ID',
    description:
      'Returns the UI document associated with the given flow. If no UI configuration has been generated or saved for that flow yet, the endpoint returns null.',
  })
  @ApiParam({
    name: 'flowId',
    description:
      'MongoDB ObjectId of the flow whose UI configuration should be fetched',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiOkResponse({
    description:
      'UI configuration fetched successfully. The response body can be null when the flow exists but has no UI document yet.',
    schema: {
      nullable: true,
      example: {
        _id: '65f2a6a83b9b2e1a708a0d51',
        flowId: '507f1f77bcf86cd799439011',
        commandTopic: 'esp/AA:BB:CC:DD:EE:FF/cmd',
        resetWifiTopic: 'esp/AA:BB:CC:DD:EE:FF/resetwifi',
        instantExecutionTopic: 'esp/AA:BB:CC:DD:EE:FF/instant',
        functionErrorTopicPattern: '/devices/AA:BB:CC:DD:EE:FF/logic/error/+',
        logicDebugTopic: '/devices/AA:BB:CC:DD:EE:FF/logic/debug',
        deviceId: '507f1f77bcf86cd799439012',
        deviceOnlineStatusTopic: 'client/AA:BB:CC:DD:EE:FF/online',
        gpioInputTaskName: 'gpio',
        gpioOutputTaskName: 'gpioOutput',
        uiItems: [
          {
            moduleId: '65f2a60b3b9b2e1a708a0d42',
            moduleName: 'Relay',
            alias: 'Water Pump',
            taskName: 'pump_control',
            topic: 'esp/AA:BB:CC:DD:EE:FF/cmd/pump',
            responseTopic: 'esp/AA:BB:CC:DD:EE:FF/state/pump',
            moduleType: 'output',
            pin: 12,
            isDigital: true,
            isAutoControlled: false,
          },
        ],
        createdAt: '2026-03-10T09:15:00.000Z',
        updatedAt: '2026-03-10T09:15:00.000Z',
      },
    },
    type: Ui,
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Missing or invalid authentication cookie',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden - You do not own the requested flow',
  })
  @IsOwner({ resource: 'flow', paramKey: 'flowId' })
  @Get('flow/:flowId')
  async findByFlowId(@Param('flowId') flowId: string) {
    const ui = await this.uiService.findByFlowId(flowId);
    let deviceId: string | null = null;
    let normalizedMac: string | null = null;
    let deviceOnlineStatusTopic: string | null = null;
    try {
      const device = await this.devicesService.findByActiveFlowId(flowId);
      deviceId = device._id?.toString() ?? null;
      if (device.macAddress) {
        normalizedMac = device.macAddress.toUpperCase();
        deviceOnlineStatusTopic = `client/${normalizedMac}/online`;
      }
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }
    if (!ui) return null;
    const uiObject = ui.toObject() as Ui & {
      functionErrorTopicPattern?: string;
      logicDebugTopic?: string;
    };

    return {
      ...uiObject,
      functionErrorTopicPattern:
        uiObject.functionErrorTopicPattern ??
        (normalizedMac ? `/devices/${normalizedMac}/logic/error/+` : undefined),
      logicDebugTopic:
        uiObject.logicDebugTopic ??
        (normalizedMac ? `/devices/${normalizedMac}/logic/debug` : undefined),
      deviceId,
      deviceOnlineStatusTopic,
    };
  }
}
