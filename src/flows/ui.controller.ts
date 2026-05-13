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
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../guards/auth/auth.guard';
import { Ui } from './schemas/ui.schema';
import { IsOwner } from '../auth/decorators/owner.decorator';
import { OwnerGuard } from '../guards/auth/owner.guard';

@ApiTags('UI (User Interface)')
@ApiBearerAuth('access-token')
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
        gpioInputTaskName: 'GpioTask',
        gpioOutputTaskName: 'GpioOutput',
        _id: '69925e3b20c0242d27feab03',
        flowId: '69925e3a20c0242d27feaafd',
        commandTopic: 'esp/AB:CD:EF:12:34:56/cmd',
        instantExecutionTopic: 'esp/AB:CD:EF:12:34:56/instant',
        resetWifiTopic: 'esp/AB:CD:EF:12:34:56/resetwifi',
        functionErrorTopicPattern: '/devices/AB:CD:EF:12:34:56/logic/error/+',
        logicDebugTopic: '/devices/AB:CD:EF:12:34:56/logic/debug',
        deviceId: '699790639e04e3d4895eb69f',
        deviceOnlineStatusTopic: 'client/AB:CD:EF:12:34:56/online',
        uiItems: [
          {
            moduleId: 'ESP32-gpio-input-analog',
            nodeId: 'ESP32-gpio-input-analog-1771199897769-sxm',
            moduleName: 'Analog Input',
            alias: 'A0',
            topic:
              'logic/input/69925e3a20c0242d27feaafd/ESP32-gpio-input-analog-1771199897769-sxm',
            moduleType: 'input',
            pin: 36,
          },
          {
            moduleId: 'ESP32-gpio-output-pwm',
            nodeId: 'ESP32-gpio-output-pwm-1771199899913-id6',
            moduleName: 'PWM Output',
            responseTopic:
              'nexusflow/output/69925e3a20c0242d27feaafd/ESP32-gpio-output-pwm-1771199899913-id6',
            moduleType: 'output',
            pin: 23,
            isFloating: false,
            isConnected: true,
          },
          {
            moduleId: 'DHT-Sensor-22',
            nodeId: 'DHT-Sensor-22-1771199904201-d9v',
            moduleName: 'DHT22',
            alias: 'Temp',
            taskName: 'DHT_13',
            topic:
              'logic/input/69925e3a20c0242d27feaafd/DHT-Sensor-22-1771199904201-d9v',
            moduleType: 'input',
            pin: 13,
          },
          {
            moduleId: 'ESP32-gpio-input-pullup',
            nodeId: 'ESP32-gpio-input-pullup-1771630217957-ucm',
            moduleName: 'Digital Input (Pullup)',
            topic:
              'logic/input/69925e3a20c0242d27feaafd/ESP32-gpio-input-pullup-1771630217957-ucm',
            moduleType: 'input',
            pin: 17,
          },
          {
            moduleId: 'Ultrasonic-Sensor',
            nodeId: 'Ultrasonic-Sensor-1776446558406-75u',
            moduleName: 'Ultrasonic',
            taskName: 'Ultrasonic_26',
            topic:
              'logic/input/69925e3a20c0242d27feaafd/Ultrasonic-Sensor-1776446558406-75u',
            moduleType: 'input',
            pin: 26,
            triggerPin: 26,
            echoPin: 27,
          },
          {
            moduleId: 'ESP32-gpio-output-servo',
            nodeId: 'ESP32-gpio-output-servo-1776552668017-krc',
            moduleName: 'Servo Output',
            responseTopic:
              'nexusflow/output/69925e3a20c0242d27feaafd/ESP32-gpio-output-servo-1776552668017-krc',
            moduleType: 'output',
            pin: 25,
            isFloating: false,
            isConnected: true,
          },
          {
            moduleId: 'ESP32-gpio-output-pwm',
            nodeId: 'ESP32-gpio-output-pwm-1777403506896-e5q',
            moduleName: 'PWM Output',
            alias: 'p21',
            responseTopic:
              'nexusflow/output/69925e3a20c0242d27feaafd/ESP32-gpio-output-pwm-1777403506896-e5q',
            moduleType: 'output',
            pin: 21,
            isFloating: true,
            isConnected: false,
          },
          {
            moduleId: 'MQ2-Sensor',
            nodeId: 'MQ2-Sensor-1777834717127-psm',
            moduleName: 'MQ2 Sensor',
            taskName: 'MQ2_14',
            topic:
              'logic/input/69925e3a20c0242d27feaafd/MQ2-Sensor-1777834717127-psm',
            moduleType: 'input',
            pin: 14,
            digitalPin: 14,
            analogPin: 32,
            isDigital: true,
            isAnalog: true,
          },
          {
            moduleId: 'PIR-Sensor',
            nodeId: 'PIR-Sensor-1777834768322-ykf',
            moduleName: 'PIR Sensor',
            taskName: 'PIR_4',
            topic:
              'logic/input/69925e3a20c0242d27feaafd/PIR-Sensor-1777834768322-ykf',
            moduleType: 'input',
            pin: 4,
          },
        ],
        createdAt: '2026-02-16T00:00:59.213Z',
        updatedAt: '2026-05-13T20:20:21.652Z',
        __v: 0,
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

    const deviceTopics = this.uiService.buildTopicsForUi(normalizedMac);

    return {
      ...uiObject,
      ...deviceTopics,
      deviceId,
      deviceOnlineStatusTopic,
    };
  }
}
