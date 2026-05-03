import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Edge as RFEdge } from './types/flow.types';
import { Node } from './schemas/node.schema';
import { UiItem } from './schemas/uiItem.schema';
import { randomInt } from 'crypto';
import {
  DEFAULT_FUNCTION_NODE_MAX_AST_NODES,
  DEFAULT_FUNCTION_NODE_MAX_CODE_LENGTH,
  validateFunctionNodeCode,
} from './function-node-security.util';
import { MODULE_DEFINITION_BY_ID, ModuleDefinition } from './module-registry';

const MODE_MAP: Record<string, number> = {
  INPUT: 1,
  OUTPUT: 3,
  INPUT_PULLUP: 5,
  OUTPUT_TOGGLE: 3,
  ANALOG: 1,
  PWM: 3,
  DAC: 3,
  SERVO: 0,
};

const CMD_MAP: Record<string, number> = {
  SET_DAC: 0x09,
  SET_PIN_MODE: 0x10,
  SET_PIN_VALUE: 0x11,
  GET_PIN_VALUE: 0x12,
  TOGGLE_PIN_VALUE: 0x13,
  ANALOG_READ: 0x20,
  ANALOG_WRITE: 0x21,
  PWM_READ: 0x22,
  DAC_WRITE: 0x24,
  DAC_READ: 0x25,
  SET_UP_SERVO: 0x40,
  READ_SERVO_ANGLE: 0x41,
  WRITE_SERVO_ANGLE: 0x42,
};

const SETUP_CMD_BY_MODULE_ID: Record<string, number> = {
  'ESP32-gpio-output-dac': CMD_MAP['SET_DAC'],
  'ESP32-gpio-output-servo': CMD_MAP['SET_UP_SERVO'],
};

const INPUT_TOPIC_PREFIX = 'logic/input';

const VALID_PINS = [
  0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32,
  33, 34, 35, 36, 39,
];
const RESERVED_PINS = [0, 1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 15, 16];
const INPUT_ONLY_PINS = [34, 35, 36, 39];
const ANALOG_PINS = [32, 33, 34, 35, 36, 39];
const DAC_PINS = [25, 26];

const GPIO_INPUT_PINS = VALID_PINS.filter(
  (pin) => !RESERVED_PINS.includes(pin)
);
const GPIO_IO_PINS = VALID_PINS.filter(
  (pin) => !RESERVED_PINS.includes(pin) && !INPUT_ONLY_PINS.includes(pin)
);

const GPIO_INPUT_PIN_SET = new Set<number>(GPIO_INPUT_PINS);
const GPIO_IO_PIN_SET = new Set<number>(GPIO_IO_PINS);
const ANALOG_PIN_SET = new Set<number>(ANALOG_PINS);
const DAC_PIN_SET = new Set<number>(DAC_PINS);

type OutputModuleType = 'pwm' | 'digital' | 'dac' | 'servo' | 'other';
type RuntimeStepType = 'input' | 'function' | 'output' | 'mqtt-out';

export const INPUT_GPIO_TASK_NAME = 'GpioTask';
export const OUTPUT_GPIO_TASK_NAME = 'GpioOutput';

export type SetupItem = {
  cmd: number;
  pin: number;
  mode: number;
  value?: number;
};

export type SetupObject = {
  setup: SetupItem[];
  tasks: Array<Record<string, any>>;
};

export type FlowStep = {
  id: string;
  moduleId: string;
  variables?: Record<string, string | number | boolean>;
  next?: string | null;
  topic?: string;
};

export type FlowExtraction = {
  flows: FlowStep[][];
  warnings: FlowNodeDiagnostic[];
};

export type RuntimeStep = {
  id: string;
  moduleId: string;
  stepType: RuntimeStepType;
  code?: string;
  targetModuleType?: OutputModuleType;
  cmd?: number;
  pin?: number;
  value?: number | string;
  topic?: string;
  variables?: Record<string, string | number | boolean>;
  channel?: string;
  targetFlowIds?: string[];
};

export type CommandExtraction = {
  flows: RuntimeStep[][];
  warnings: FlowNodeDiagnostic[];
};

export type FlowNodeDiagnosticSeverity = 'warning' | 'error';

export type FlowNodeDiagnostic = {
  nodeId: string;
  severity: FlowNodeDiagnosticSeverity;
  message: string;
  code?: string;
  nodeName?: string;
  moduleId?: string;
};

type NodeStoredDiagnostic = Pick<
  FlowNodeDiagnostic,
  'severity' | 'message' | 'code'
>;

type Task = {
  taskName: string;
  intervalMs: number;
  topic?: string;
  pin?: number;
  type?: number;
  digitalPin?: number;
  analogPin?: number;
  useDigital?: boolean;
  useAnalog?: boolean;
  echoPin?: number;
  triggerPin?: number;
  commands?: Array<{
    cmd: number;
    pin?: number;
    topic: string;
    value?: number | string;
  }>;
  command?: {
    cmd: number;
    pin: number;
    topic: string;
    value?: number | string;
  };
};

export type TopicsData = {
  commandTopic?: string;
  resetWifiTopic?: string;
  instantExecutionTopic?: string;
  functionErrorTopicPattern?: string;
  logicDebugTopic?: string;
};

@Injectable()
export class FlowBuilderService {
  private readonly minIntervalMs: number;
  private readonly maxIntervalMs: number;
  private readonly defaultGpioIntervalMs: number;
  private readonly defaultGpioOutputIntervalMs: number;
  private readonly defaultSensorIntervalMs: number;
  private readonly defaultPirIntervalMs: number;
  private readonly functionNodeMaxCodeLength: number;
  private readonly functionNodeMaxAstNodes: number;

  constructor(private readonly configService: ConfigService) {
    this.minIntervalMs = this.readConfigNumber('MIN_INTERVAL_MS', 250);
    this.maxIntervalMs = this.readConfigNumber('MAX_INTERVAL_MS', 60000);
    this.defaultGpioIntervalMs = this.readConfigNumber(
      'DEFAULT_GPIO_INTERVAL_MS',
      1000
    );
    this.defaultGpioOutputIntervalMs = this.readConfigNumber(
      'DEFAULT_GPIO_OUTPUT_INTERVAL_MS',
      10000
    );
    this.defaultSensorIntervalMs = this.readConfigNumber(
      'DEFAULT_SENSOR_INTERVAL_MS',
      5000
    );
    this.defaultPirIntervalMs = this.readConfigNumber(
      'DEFAULT_PIR_INTERVAL_MS',
      1000
    );
    this.functionNodeMaxCodeLength = this.readConfigNumber(
      'FUNCTION_NODE_MAX_CODE_LENGTH',
      DEFAULT_FUNCTION_NODE_MAX_CODE_LENGTH
    );
    this.functionNodeMaxAstNodes = this.readConfigNumber(
      'FUNCTION_NODE_MAX_AST_NODES',
      DEFAULT_FUNCTION_NODE_MAX_AST_NODES
    );
  }

  private readConfigNumber(name: string, fallback: number): number {
    const raw = this.configService.get<string | number>(name);
    if (raw === undefined || raw === null || raw === '') return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.trunc(parsed);
  }

  private toOptionalNumber(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private toBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return Boolean(value);
  }

  private resolveInterval(value: unknown, fallback: number): number {
    const parsed = this.toOptionalNumber(value);
    if (parsed === undefined) return fallback;
    const normalized = Math.trunc(parsed);
    if (!Number.isFinite(normalized) || normalized <= 0) return fallback;
    return Math.min(
      this.maxIntervalMs,
      Math.max(this.minIntervalMs, normalized)
    );
  }

  private getNodeLabel(node: Node | undefined): string {
    return node?.data?.alias || node?.data?.name || node?.id || 'Unknown node';
  }

  private createNodeDiagnostic(
    node: Node,
    severity: FlowNodeDiagnosticSeverity,
    message: string,
    code?: string
  ): FlowNodeDiagnostic {
    return {
      nodeId: node.id,
      severity,
      message,
      code,
    };
  }

  private ensureIntegerPin(
    node: Node,
    value: unknown,
    fieldName: string,
    code: string
  ): number | undefined {
    const pin = this.toOptionalNumber(value);
    if (pin === undefined) return undefined;
    if (!Number.isInteger(pin)) {
      this.throwNodeError(
        node,
        `Invalid ${fieldName} for ${this.getNodeLabel(node)}. Pin values must be integers.`,
        code
      );
    }
    return pin;
  }

  private assertAllowedPin(
    node: Node,
    pin: number,
    allowedPins: Set<number>,
    takenPins: Set<number>,
    fieldName: string,
    code: string
  ): void {
    if (!allowedPins.has(pin)) {
      this.throwNodeError(
        node,
        `Invalid ${fieldName} ${pin} for ${this.getNodeLabel(node)}.`,
        code
      );
    }
    if (takenPins.has(pin)) {
      this.throwNodeError(
        node,
        `Pin ${pin} is already used by another node, cannot be assigned to ${this.getNodeLabel(node)}.`,
        'NODE_PIN_ALREADY_USED'
      );
    }
    takenPins.add(pin);
  }

  private getValidatedModuleDefinition(node: Node): ModuleDefinition {
    const moduleId = String(node.data?.moduleId ?? '').trim();
    const moduleDefinition = MODULE_DEFINITION_BY_ID.get(moduleId);

    if (!moduleDefinition) {
      this.throwNodeError(
        node,
        `Unsupported moduleId "${moduleId}" for ${this.getNodeLabel(node)}.`,
        'NODE_MODULE_UNSUPPORTED'
      );
    }

    return moduleDefinition;
  }

  private validateAndNormalizeModuleData(
    node: Node,
    moduleDefinition: ModuleDefinition
  ): void {
    const incomingPinMode = node.data?.pinMode;
    if (
      incomingPinMode !== undefined &&
      incomingPinMode !== moduleDefinition.pinMode
    ) {
      this.throwNodeError(
        node,
        `Invalid pinMode for ${this.getNodeLabel(node)}.`,
        'NODE_MODULE_SCHEMA_INVALID'
      );
    }

    const incomingPorts = node.data?.ports;
    if (
      incomingPorts !== undefined &&
      incomingPorts !== moduleDefinition.ports
    ) {
      this.throwNodeError(
        node,
        `Invalid ports for ${this.getNodeLabel(node)}.`,
        'NODE_MODULE_SCHEMA_INVALID'
      );
    }

    const incomingType = node.data?.type;
    if (incomingType !== undefined && incomingType !== moduleDefinition.type) {
      this.throwNodeError(
        node,
        `Invalid type for ${this.getNodeLabel(node)}.`,
        'NODE_MODULE_SCHEMA_INVALID'
      );
    }

    node.data = {
      ...node.data,
      moduleId: moduleDefinition.id,
      name: moduleDefinition.name,
      pinMode: moduleDefinition.pinMode,
      ports: moduleDefinition.ports,
      type: moduleDefinition.type,
    };
  }

  private appendNodeWarning(
    node: Node,
    message: string,
    code?: string
  ): FlowNodeDiagnostic {
    const warning = this.createNodeDiagnostic(node, 'warning', message, code);
    const existingWarnings: NodeStoredDiagnostic[] = Array.isArray(
      node.data?.warnings
    )
      ? (node.data.warnings as NodeStoredDiagnostic[])
      : [];

    node.data = {
      ...node.data,
      warnings: [
        ...existingWarnings,
        {
          severity: warning.severity,
          message: warning.message,
          code: warning.code,
        },
      ],
    };

    return warning;
  }

  private collectNodeWarnings(nodes: Node[]): FlowNodeDiagnostic[] {
    return nodes.flatMap((node) => {
      const nodeWarnings: NodeStoredDiagnostic[] = Array.isArray(
        node.data?.warnings
      )
        ? (node.data.warnings as NodeStoredDiagnostic[])
        : [];

      return nodeWarnings
        .filter((warning) => warning.severity === 'warning')
        .map((warning) => ({
          nodeId: node.id,
          severity: warning.severity,
          message: warning.message,
          code: warning.code,
        }));
    });
  }

  private throwNodeError(node: Node, message: string, code?: string): never {
    const diagnostic = this.createNodeDiagnostic(node, 'error', message, code);
    throw new BadRequestException({
      message,
      code,
      nodeDiagnostics: [diagnostic],
    });
  }

  private buildInputTopic(nodeId: string): string {
    return `${INPUT_TOPIC_PREFIX}/${nodeId}`;
  }

  validateFlowStructure(nodes: Node[], edges: RFEdge[]): void {
    if (!nodes || nodes.length === 0) {
      throw new BadRequestException(
        'Flow must contain at least one node to be created'
      );
    }
    if (!edges) {
      throw new BadRequestException('Flow edges are required to create a flow');
    }

    // Validate nodes have required properties
    nodes.forEach((node, index) => {
      if (!node.id) {
        throw new BadRequestException(
          `Node at index ${index} is missing required field: id`
        );
      }
      if (!node.type) {
        throw new BadRequestException(
          `Node "${node.id}" is missing required field: type`
        );
      }
      if (!node.position) {
        throw new BadRequestException(
          `Node "${node.id}" is missing required field: position. Nodes must have position with x and y coordinates.`
        );
      }
      if (
        typeof node.position.x !== 'number' ||
        typeof node.position.y !== 'number'
      ) {
        throw new BadRequestException(
          `Node "${node.id}" has invalid position. Both x and y must be numbers.`
        );
      }
      if (!node.data) {
        throw new BadRequestException(
          `Node "${node.id}" is missing required field: data`
        );
      }
      if (!node.data.name || !node.data.moduleId) {
        throw new BadRequestException(
          `Node "${node.id}" data is missing required fields. Must include: name, moduleId`
        );
      }
      if (!node.measured) {
        throw new BadRequestException(
          `Node "${node.id}" is missing required field: measured. Nodes must have measured with width and height.`
        );
      }
      if (
        typeof node.measured.width !== 'number' ||
        typeof node.measured.height !== 'number'
      ) {
        throw new BadRequestException(
          `Node "${node.id}" has invalid measured dimensions. Both width and height must be numbers.`
        );
      }

      const moduleDefinition = this.getValidatedModuleDefinition(node);
      this.validateAndNormalizeModuleData(node, moduleDefinition);
    });

    // Validate edges
    edges.forEach((edge, index) => {
      if (!edge.id) {
        throw new BadRequestException(
          `Edge at index ${index} is missing required field: id`
        );
      }
      if (!edge.source) {
        throw new BadRequestException(
          `Edge "${edge.id}" is missing required field: source`
        );
      }
      if (!edge.target) {
        throw new BadRequestException(
          `Edge "${edge.id}" is missing required field: target`
        );
      }
      const sourceNode = nodes.find((n) => n.id === edge.source);
      if (!sourceNode) {
        throw new BadRequestException(
          `Edge "${edge.id}" references non-existent source node: "${edge.source}"`
        );
      }
      const targetNode = nodes.find((n) => n.id === edge.target);
      if (!targetNode) {
        throw new BadRequestException(
          `Edge "${edge.id}" references non-existent target node: "${edge.target}"`
        );
      }
    });

    const targetNodeConnectionCount: Record<string, number> = {};
    edges.forEach((edge) => {
      if (!targetNodeConnectionCount[edge.target]) {
        targetNodeConnectionCount[edge.target] = 0;
      }
      targetNodeConnectionCount[edge.target]++;
    });
    for (const [nodeId, count] of Object.entries(targetNodeConnectionCount)) {
      if (count > 1) {
        const targetNode = nodes.find((n) => n.id === nodeId);
        if (targetNode) {
          this.throwNodeError(
            targetNode,
            `Node ${targetNode?.data.alias || targetNode?.data.name} is connected to multiple nodes`,
            'NODE_MULTIPLE_INCOMING_CONNECTIONS'
          );
        }

        throw new BadRequestException(
          `Node ${nodeId} is connected to multiple nodes`
        );
      }
    }
  }

  buildSetupFromNodes(nodes: Node[]): SetupObject {
    const setupPins: Record<number, SetupItem> = {};
    const takenPins: Set<number> = new Set();
    const gpioTask: Task = {
      taskName: INPUT_GPIO_TASK_NAME,
      intervalMs: this.defaultGpioIntervalMs,
      commands: [],
    };
    const outputTask: Task = {
      taskName: OUTPUT_GPIO_TASK_NAME,
      intervalMs: this.defaultGpioOutputIntervalMs,
      commands: [],
    };
    let hasGpioIntervalOverride = false;
    let hasOutputIntervalOverride = false;
    const sensorsTask: Record<string, Task[]> = {};
    nodes.forEach((node) => {
      const module = node.data;
      const moduleDefinition = this.getValidatedModuleDefinition(node);
      if (
        module.moduleId.startsWith('ESP32-gpio-input') ||
        module.moduleId.startsWith('ESP32-gpio-output')
      ) {
        const pinNumber = this.ensureIntegerPin(
          node,
          module.variables?.pinNumber,
          'pinNumber',
          'NODE_PIN_NOT_INTEGER'
        );
        const pinModeStr = moduleDefinition.pinMode;
        if (pinNumber !== undefined && pinModeStr) {
          const pinMode = MODE_MAP[pinModeStr];
          if (pinMode === undefined) {
            this.throwNodeError(
              node,
              `Invalid pin configuration for ${module?.alias || module.name}`,
              'NODE_PIN_CONFIGURATION_INVALID'
            );
          }

          if (module.moduleId.startsWith('ESP32-gpio-input-analog')) {
            this.assertAllowedPin(
              node,
              pinNumber,
              ANALOG_PIN_SET,
              takenPins,
              'analog pin',
              'NODE_ANALOG_PIN_INVALID'
            );
          } else if (module.moduleId.startsWith('ESP32-gpio-input')) {
            this.assertAllowedPin(
              node,
              pinNumber,
              GPIO_INPUT_PIN_SET,
              takenPins,
              'input pin',
              'NODE_INPUT_PIN_INVALID'
            );
          } else if (module.moduleId.startsWith('ESP32-gpio-output-dac')) {
            this.assertAllowedPin(
              node,
              pinNumber,
              DAC_PIN_SET,
              takenPins,
              'dac pin',
              'NODE_DAC_PIN_INVALID'
            );
          } else if (module.moduleId.startsWith('ESP32-gpio-output')) {
            this.assertAllowedPin(
              node,
              pinNumber,
              GPIO_IO_PIN_SET,
              takenPins,
              'output pin',
              'NODE_OUTPUT_PIN_INVALID'
            );
          }

          // Build setup item

          const setupItem: SetupItem = {
            cmd:
              SETUP_CMD_BY_MODULE_ID[module.moduleId] ??
              CMD_MAP['SET_PIN_MODE'],
            pin: pinNumber,
            mode: pinMode,
          };
          // For outputs, set an initial value of 0
          if (module.moduleId === 'ESP32-gpio-output') {
            setupItem.value = 0;
          } else if (module.moduleId === 'ESP32-gpio-output-servo') {
            const initialAngle = this.toOptionalNumber(
              module.variables?.initialAngle
            );
            setupItem.value = Math.min(
              180,
              Math.max(0, Math.trunc(initialAngle ?? 0))
            );
          }

          setupPins[pinNumber] = setupItem;
          // Add to GPIO task commands
          if (module.moduleId.startsWith('ESP32-gpio-input')) {
            const moduleInterval = this.toOptionalNumber(
              module.variables?.intervalMs
            );
            if (moduleInterval !== undefined) {
              const effectiveInterval = this.resolveInterval(
                moduleInterval,
                this.defaultGpioIntervalMs
              );
              if (!hasGpioIntervalOverride) {
                gpioTask.intervalMs = effectiveInterval;
                hasGpioIntervalOverride = true;
              } else {
                gpioTask.intervalMs = Math.min(
                  gpioTask.intervalMs,
                  effectiveInterval
                );
              }
            }

            let cmd = 0;

            switch (module.moduleId) {
              case 'ESP32-gpio-input':
              case 'ESP32-gpio-input-pullup':
                cmd = CMD_MAP['GET_PIN_VALUE'];
                break;
              case 'ESP32-gpio-input-analog':
                cmd = CMD_MAP['ANALOG_READ'];
                break;
              default:
                this.throwNodeError(
                  node,
                  `Unsupported module ${module?.alias || module.name}`,
                  'MODULE_UNSUPPORTED'
                );
            }

            gpioTask.commands!.push({
              cmd: cmd,
              pin: pinNumber,
              topic: this.buildInputTopic(node.id),
            });
          } else if (module.moduleId.startsWith('ESP32-gpio-output')) {
            const moduleInterval = this.toOptionalNumber(
              module.variables?.intervalMs
            );
            if (moduleInterval !== undefined) {
              const effectiveInterval = this.resolveInterval(
                moduleInterval,
                this.defaultGpioOutputIntervalMs
              );
              if (!hasOutputIntervalOverride) {
                outputTask.intervalMs = effectiveInterval;
                hasOutputIntervalOverride = true;
              } else {
                outputTask.intervalMs = Math.min(
                  outputTask.intervalMs,
                  effectiveInterval
                );
              }
            }

            let cmd = 0;
            switch (module.moduleId) {
              case 'ESP32-gpio-output':
              case 'ESP32-gpio-output-led':
                cmd = CMD_MAP['GET_PIN_VALUE'];
                break;
              case 'ESP32-gpio-output-pwm':
                cmd = CMD_MAP['PWM_READ'];
                break;
              case 'ESP32-gpio-output-dac':
                cmd = CMD_MAP['DAC_READ'];
                break;
              case 'ESP32-gpio-output-servo':
                cmd = CMD_MAP['READ_SERVO_ANGLE'];
                break;
              default:
                this.throwNodeError(
                  node,
                  `Unsupported module ${module?.alias || module.name}`,
                  'MODULE_UNSUPPORTED'
                );
            }
            outputTask.commands!.push({
              cmd: cmd,
              pin: pinNumber,
              topic: `nexusflow/output/${node.id}`,
            });
          }
        } else {
          this.throwNodeError(
            node,
            `Missing configuration for node ${module?.alias || module.name}`,
            'NODE_CONFIGURATION_MISSING'
          );
        }
      }

      if (
        module.moduleId.startsWith('DHT-Sensor') ||
        module.moduleId.startsWith('PIR-Sensor') ||
        module.moduleId.startsWith('Ultrasonic-Sensor')
      ) {
        const pinNumber = this.ensureIntegerPin(
          node,
          module.variables?.pinNumber,
          'pinNumber',
          'NODE_PIN_NOT_INTEGER'
        );
        const triggerPin = this.ensureIntegerPin(
          node,
          module.variables?.triggerPin,
          'triggerPin',
          'NODE_TRIGGER_PIN_NOT_INTEGER'
        );
        const echoPin = this.ensureIntegerPin(
          node,
          module.variables?.echoPin,
          'echoPin',
          'NODE_ECHO_PIN_NOT_INTEGER'
        );

        if (
          module.moduleId.startsWith('Ultrasonic-Sensor') &&
          (triggerPin === undefined || echoPin === undefined)
        ) {
          this.throwNodeError(
            node,
            `Missing trigger/echo pin configuration for ${module?.alias || module.name}`,
            'ULTRASONIC_TRIGGER_ECHO_MISSING'
          );
        }

        if (
          !module.moduleId.startsWith('Ultrasonic-Sensor') &&
          pinNumber === undefined
        ) {
          this.throwNodeError(
            node,
            `Missing pin configuration for  ${module?.alias || module.name}`,
            'NODE_PIN_CONFIGURATION_MISSING'
          );
        }

        if (module.moduleId.startsWith('Ultrasonic-Sensor')) {
          this.assertAllowedPin(
            node,
            triggerPin!,
            GPIO_IO_PIN_SET,
            takenPins,
            'trigger pin',
            'ULTRASONIC_TRIGGER_PIN_INVALID'
          );
          this.assertAllowedPin(
            node,
            echoPin!,
            GPIO_INPUT_PIN_SET,
            takenPins,
            'echo pin',
            'ULTRASONIC_ECHO_PIN_INVALID'
          );
        } else {
          this.assertAllowedPin(
            node,
            pinNumber!,
            GPIO_INPUT_PIN_SET,
            takenPins,
            'input pin',
            'NODE_INPUT_PIN_INVALID'
          );
        }

        const sensorType = module.moduleId.startsWith('Ultrasonic-Sensor')
          ? 'ULTRA'
          : module.moduleId.startsWith('DHT-Sensor')
            ? 'DHT'
            : 'PIR';

        if (!sensorsTask[sensorType]) {
          sensorsTask[sensorType] = [];
        }

        const taskPin = module.moduleId.startsWith('Ultrasonic-Sensor')
          ? triggerPin
          : pinNumber;
        const taskName = this.generateTaskName(module.moduleId, taskPin);

        const taskData: Task = {
          taskName,
          intervalMs: this.resolveInterval(
            module.variables?.intervalMs,
            sensorType === 'PIR'
              ? this.defaultPirIntervalMs
              : this.defaultSensorIntervalMs
          ),
          topic: this.buildInputTopic(node.id),
        };

        if (sensorType === 'DHT') {
          taskData.pin = pinNumber;
          taskData.type = module.moduleId === 'DHT-Sensor-11' ? 11 : 22;
        } else if (sensorType === 'PIR') {
          taskData.pin = pinNumber;
        } else if (sensorType === 'ULTRA') {
          taskData.triggerPin = triggerPin;
          taskData.echoPin = echoPin;
        }

        sensorsTask[sensorType].push(taskData);
      }
      if (
        module.moduleId.startsWith('MQ2-Sensor') ||
        module.moduleId.startsWith('Rain-Sensor') ||
        module.moduleId.startsWith('Soil-Sensor')
      ) {
        const analogPin = this.ensureIntegerPin(
          node,
          module.variables?.analogPin,
          'analogPin',
          'NODE_ANALOG_PIN_NOT_INTEGER'
        );
        const digitalPin = this.ensureIntegerPin(
          node,
          module.variables?.digitalPin,
          'digitalPin',
          'NODE_DIGITAL_PIN_NOT_INTEGER'
        );
        const isDigital = this.toBoolean(module.variables?.isDigital);
        const isAnalog = this.toBoolean(module.variables?.isAnalog);
        if (
          (isDigital && digitalPin !== undefined) ||
          (isAnalog && analogPin !== undefined)
        ) {
          if (isDigital && digitalPin !== undefined) {
            this.assertAllowedPin(
              node,
              digitalPin,
              GPIO_INPUT_PIN_SET,
              takenPins,
              'digital pin',
              'NODE_DIGITAL_PIN_INVALID'
            );
          }

          if (isAnalog && analogPin !== undefined) {
            this.assertAllowedPin(
              node,
              analogPin,
              ANALOG_PIN_SET,
              takenPins,
              'analog pin',
              'NODE_ANALOG_PIN_INVALID'
            );
          }

          const sensorType = module.moduleId.split('-')[0]; // e.g., "MQ2", "Rain", "Soil"
          // Add to MQ2 sensors task
          if (!sensorsTask[sensorType]) {
            sensorsTask[sensorType] = [];
          }
          const taskName = this.generateTaskName(
            module.moduleId,
            isDigital ? digitalPin : analogPin
          );
          sensorsTask[sensorType].push({
            taskName,
            intervalMs: this.resolveInterval(
              module.variables?.intervalMs,
              this.defaultSensorIntervalMs
            ),
            topic: this.buildInputTopic(node.id),
            digitalPin: digitalPin,
            analogPin: analogPin,
            useDigital: isDigital,
            useAnalog: isAnalog,
          });
        } else {
          this.throwNodeError(
            node,
            `Missing pin configuration for ${module?.alias || module.name}`,
            'NODE_PIN_CONFIGURATION_MISSING'
          );
        }
      }
    });

    const tasks: Array<Record<string, any>> = [];
    if (gpioTask.commands && gpioTask.commands.length > 0) {
      tasks.push({ gpio: gpioTask });
    }
    if (outputTask.commands && outputTask.commands.length > 0) {
      tasks.push({ gpioOutput: outputTask });
    }
    if (Object.keys(sensorsTask).length > 0) {
      tasks.push({ sensors: [sensorsTask] });
    }

    return { setup: Object.values(setupPins), tasks };
  }
  private generateTaskName(
    moduleId: string,
    pinNumber: number | undefined
  ): string {
    //get the first part of the module name before any dashes
    const baseName = moduleId.split('-')[0];
    return `${baseName}_${pinNumber ? pinNumber : randomInt(1, 9999)}`;
  }

  buildUiFromNodes(
    nodes: Node[],
    edges: RFEdge[],
    deviceMac?: string,
    flowId?: string
  ): UiItem[] {
    if (nodes.length === 0) {
      throw new BadRequestException('Flow must contain at least one node');
    }

    const uiElements: UiItem[] = [];
    const resolvedMac = this.normalizeMacAddress(deviceMac);
    const commandTopic = resolvedMac ? `esp/${resolvedMac}/cmd` : undefined;
    const connectedOutputIds = new Set<string>(
      edges?.map((e) => e.target) ?? []
    );

    nodes.forEach((node) => {
      const module = node.data;

      if (module.moduleId.startsWith('logic-function')) {
        return; // Skip function nodes in UI generation
      }

      if (module.moduleId === 'mqtt-out') {
        return;
      }

      if (module.moduleId === 'mqtt-in') {
        uiElements.push({
          moduleId: module.moduleId,
          moduleName: module.name,
          alias: module.alias,
          moduleType: 'input',
          topic: flowId
            ? `nexusflow/ui/mqtt-in/${flowId}/${node.id}`
            : `nexusflow/ui/mqtt-in/${node.id}`,
          channel: this.normalizeMqttChannel(module.variables?.channel),
        });
        return;
      }

      if (module.moduleId.startsWith('ESP32-gpio-output')) {
        const pinNumber = this.toOptionalNumber(module.variables?.pinNumber);
        if (pinNumber !== undefined) {
          uiElements.push({
            moduleId: module.moduleId,
            moduleName: module.name,
            alias: module.alias,
            pin: pinNumber,
            responseTopic: `nexusflow/output/${node.id}`,
            moduleType: 'output',
            topic: commandTopic,
            isFloating: !connectedOutputIds.has(node.id),
          });
        }
        return;
      }

      if (
        module.moduleId.startsWith('MQ2-Sensor') ||
        module.moduleId.startsWith('Rain-Sensor') ||
        module.moduleId.startsWith('Soil-Sensor')
      ) {
        const isDigital = this.toBoolean(module.variables?.isDigital);
        const isAnalog = this.toBoolean(module.variables?.isAnalog);

        const digitalPin = this.toOptionalNumber(module.variables?.digitalPin);
        const analogPin = this.toOptionalNumber(module.variables?.analogPin);

        if (
          (isDigital && digitalPin === undefined) ||
          (isAnalog && analogPin === undefined)
        ) {
          this.throwNodeError(
            node,
            `Missing pin configuration for ${module?.alias || module.name}`,
            'NODE_PIN_CONFIGURATION_MISSING'
          );
        }

        uiElements.push({
          moduleId: module.moduleId,
          moduleName: module.name,
          alias: module.alias,
          taskName: this.generateTaskName(
            module.moduleId,
            isDigital ? digitalPin : analogPin
          ),
          moduleType: 'input',
          topic: this.buildInputTopic(node.id),
          pin: isDigital ? digitalPin : analogPin,
          digitalPin,
          analogPin,
          isDigital,
          isAnalog,
        });
        return;
      }

      if (module.moduleId.startsWith('ESP32-gpio-input')) {
        const pinNumber = this.toOptionalNumber(module.variables?.pinNumber);
        if (pinNumber === undefined) {
          this.throwNodeError(
            node,
            `Missing pin configuration for ${module?.alias || module.name}`,
            'NODE_PIN_CONFIGURATION_MISSING'
          );
        }
        uiElements.push({
          moduleId: module.moduleId,
          moduleName: module.name,
          alias: module.alias,
          moduleType: 'input',
          pin: pinNumber,
          topic: this.buildInputTopic(node.id),
        });
        return;
      }

      if (
        module.moduleId.startsWith('DHT-Sensor') ||
        module.moduleId.startsWith('PIR-Sensor') ||
        module.moduleId.startsWith('Ultrasonic-Sensor')
      ) {
        const pinNumber = this.toOptionalNumber(module.variables?.pinNumber);
        const triggerPin = this.toOptionalNumber(module.variables?.triggerPin);
        const echoPin = this.toOptionalNumber(module.variables?.echoPin);

        if (
          module.moduleId.startsWith('Ultrasonic-Sensor') &&
          (triggerPin === undefined || echoPin === undefined)
        ) {
          this.throwNodeError(
            node,
            `Missing trigger/echo pin configuration for ${module?.alias || module.name}`,
            'ULTRASONIC_TRIGGER_ECHO_MISSING'
          );
        }

        if (
          !module.moduleId.startsWith('Ultrasonic-Sensor') &&
          pinNumber === undefined
        ) {
          this.throwNodeError(
            node,
            `Missing pin configuration for ${module?.alias || module.name}`,
            'NODE_PIN_CONFIGURATION_MISSING'
          );
        }

        const taskPin = module.moduleId.startsWith('Ultrasonic-Sensor')
          ? triggerPin
          : pinNumber;

        uiElements.push({
          moduleId: module.moduleId,
          moduleName: module.name,
          alias: module.alias,
          taskName: this.generateTaskName(module.moduleId, taskPin),
          moduleType: 'input',
          pin: taskPin,
          triggerPin,
          echoPin,
          topic: this.buildInputTopic(node.id),
        });
        return;
      }

      uiElements.push({
        moduleId: module.moduleId,
        moduleName: module.name,
        alias: module.alias,
        moduleType: 'input',
        topic: this.buildInputTopic(node.id),
      });
    });
    return uiElements;
  }

  private normalizeMacAddress(macAddress?: string): string | undefined {
    if (!macAddress) return undefined;
    const trimmed = macAddress.trim();
    if (!trimmed) return undefined;
    return trimmed.toUpperCase();
  }

  private isInputModule(moduleId: string): boolean {
    return (
      moduleId.startsWith('mqtt-in') ||
      moduleId.startsWith('ESP32-gpio-input') ||
      moduleId.startsWith('DHT-Sensor') ||
      moduleId.startsWith('PIR-Sensor') ||
      moduleId.startsWith('MQ2-Sensor') ||
      moduleId.startsWith('Rain-Sensor') ||
      moduleId.startsWith('Soil-Sensor') ||
      moduleId.startsWith('Ultrasonic-Sensor')
    );
  }

  private isFunctionModule(moduleId: string): boolean {
    return moduleId.startsWith('logic-function');
  }

  private resolveTargetModuleType(moduleId: string): OutputModuleType {
    if (moduleId.startsWith('ESP32-gpio-output-pwm')) {
      return 'pwm';
    } else if (moduleId.startsWith('ESP32-gpio-output-dac')) {
      return 'dac';
    } else if (moduleId.startsWith('ESP32-gpio-output-servo')) {
      return 'servo';
    } else if (moduleId.startsWith('ESP32-gpio-output')) {
      return 'digital';
    } else {
      return 'other';
    }
  }

  private isOutputModule(moduleId: string): boolean {
    return (
      moduleId.startsWith('ESP32-gpio-output') ||
      moduleId.startsWith('mqtt-out')
    );
  }

  private normalizeMqttChannel(value: string | number | boolean): string {
    const channel = String(value ?? 'default')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    return channel || 'default';
  }

  private parseTargetFlowIds(value: string | number | boolean): string[] {
    return Array.from(
      new Set(
        String(value ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );
  }

  private resolveOutputCommand(moduleId: string): number | undefined {
    switch (moduleId) {
      case 'ESP32-gpio-output':
      case 'ESP32-gpio-output-led':
        return CMD_MAP['SET_PIN_VALUE'];
      case 'ESP32-gpio-output-pwm':
        return CMD_MAP['ANALOG_WRITE'];
      case 'ESP32-gpio-output-dac':
        return CMD_MAP['DAC_WRITE'];
      case 'ESP32-gpio-output-servo':
        return CMD_MAP['WRITE_SERVO_ANGLE'];
      default:
        return undefined;
    }
  }

  private buildNodeByIdMap(nodes: Node[]): Map<string, Node> {
    const nodeById = new Map<string, Node>();
    for (const node of nodes) {
      nodeById.set(node.id, node);
    }
    return nodeById;
  }

  private buildOutgoingEdgesMap(edges: RFEdge[]): Map<string, RFEdge[]> {
    const outgoingEdgesByNode = new Map<string, RFEdge[]>();
    for (const edge of edges) {
      if (!outgoingEdgesByNode.has(edge.source)) {
        outgoingEdgesByNode.set(edge.source, []);
      }
      outgoingEdgesByNode.get(edge.source)!.push(edge);
    }
    return outgoingEdgesByNode;
  }

  private buildOutputStepFromNode(targetNode: Node): RuntimeStep | null {
    const targetModuleId = targetNode.data?.moduleId ?? '';
    if (!this.isOutputModule(targetModuleId)) {
      return null;
    }

    if (targetModuleId === 'mqtt-out') {
      const targetFlowIds = this.parseTargetFlowIds(
        targetNode.data?.variables?.targetFlowIds
      );

      if (!targetFlowIds.length) {
        this.appendNodeWarning(
          targetNode,
          `Flow Bridge Out node ${this.getNodeLabel(targetNode)} has no target flows and was skipped.`,
          'MQTT_OUT_TARGET_FLOWS_MISSING'
        );
        return null;
      }

      return {
        id: targetNode.id,
        moduleId: targetModuleId,
        stepType: 'mqtt-out',
        channel: this.normalizeMqttChannel(targetNode.data?.variables?.channel),
        targetFlowIds,
      };
    }

    const pin = this.toOptionalNumber(targetNode.data?.variables?.pinNumber);
    if (pin === undefined) {
      this.appendNodeWarning(
        targetNode,
        `Output node ${targetNode.id} is missing pinNumber and was skipped.`,
        'OUTPUT_NODE_MISSING_PIN'
      );
      return null;
    }

    const cmd = this.resolveOutputCommand(targetModuleId);
    if (cmd === undefined) {
      this.appendNodeWarning(
        targetNode,
        `Unsupported output module ${targetModuleId} on node ${targetNode.id}.`,
        'OUTPUT_MODULE_UNSUPPORTED'
      );
      return null;
    }

    return {
      id: targetNode.id,
      moduleId: targetModuleId,
      stepType: 'output',
      targetModuleType: this.resolveTargetModuleType(targetModuleId),
      cmd,
      pin,
      value: '$prev',
      topic: `nexusflow/output/${targetNode.id}`,
    };
  }

  private validateFunctionCode(code: string): string | null {
    return validateFunctionNodeCode(code, {
      maxCodeLength: this.functionNodeMaxCodeLength,
      maxAstNodes: this.functionNodeMaxAstNodes,
    });
  }

  private validateFunctionNodes(nodes: Node[]): void {
    for (const node of nodes) {
      if (!this.isFunctionModule(node.data?.moduleId ?? '')) {
        continue;
      }

      const code = String(node.data?.variables?.code ?? '').trim();
      if (!code) {
        continue;
      }

      const validationError = this.validateFunctionCode(code);
      if (validationError) {
        this.throwNodeError(
          node,
          `Invalid function code in node ${this.getNodeLabel(node)}: ${validationError}`,
          'FUNCTION_NODE_INVALID_CODE'
        );
      }
    }
  }

  private warnFloatingFunctionNodes(nodes: Node[], edges: RFEdge[]): void {
    const connectedNodeIds = new Set<string>();

    for (const edge of edges) {
      if (edge.source) {
        connectedNodeIds.add(edge.source);
      }
      if (edge.target) {
        connectedNodeIds.add(edge.target);
      }
    }

    for (const node of nodes) {
      if (!this.isFunctionModule(node.data?.moduleId ?? '')) {
        continue;
      }

      if (connectedNodeIds.has(node.id)) {
        continue;
      }

      this.appendNodeWarning(
        node,
        `Function node ${this.getNodeLabel(node)} is floating and was skipped.`,
        'FUNCTION_NODE_FLOATING'
      );
    }
  }

  private buildFunctionStepFromNode(node: Node): RuntimeStep {
    const code = String(node.data?.variables?.code ?? '').trim();
    if (!code) {
      this.appendNodeWarning(
        node,
        `Function node ${this.getNodeLabel(node)} has no code. It will behave like "return msg;".`,
        'FUNCTION_NODE_EMPTY_CODE'
      );

      return {
        id: node.id,
        moduleId: node.data?.moduleId ?? 'logic-function',
        stepType: 'function',
        code: 'return msg;',
      };
    }

    const validationError = this.validateFunctionCode(code);
    if (validationError) {
      this.throwNodeError(
        node,
        `Invalid function code in node ${this.getNodeLabel(node)}: ${validationError}`,
        'FUNCTION_NODE_INVALID_CODE'
      );
    }

    return {
      id: node.id,
      moduleId: node.data?.moduleId ?? 'logic-function',
      stepType: 'function',
      code,
    };
  }

  private buildPathsFromNode(
    node: Node,
    nodeById: Map<string, Node>,
    outgoingEdgesByNode: Map<string, RFEdge[]>,
    visited: Set<string>
  ): RuntimeStep[][] {
    if (visited.has(node.id)) {
      this.appendNodeWarning(
        node,
        `Cycle detected at node ${node.id}. This path was skipped.`,
        'FLOW_CYCLE_DETECTED'
      );
      return [];
    }

    const nextVisited = new Set(visited);
    nextVisited.add(node.id);
    const outgoing = outgoingEdgesByNode.get(node.id) ?? [];

    if (!outgoing.length) {
      return [];
    }

    const paths: RuntimeStep[][] = [];

    for (const edge of outgoing) {
      const targetNode = nodeById.get(edge.target);
      if (!targetNode) {
        this.appendNodeWarning(
          node,
          `Edge ${edge.id || `${edge.source}->${edge.target}`} references missing target node ${edge.target}.`,
          'EDGE_TARGET_NODE_MISSING'
        );
        continue;
      }

      const targetModuleId = targetNode.data?.moduleId ?? '';
      if (
        node.data?.moduleId === 'mqtt-in' &&
        !this.isFunctionModule(targetModuleId)
      ) {
        this.throwNodeError(
          targetNode,
          `Flow Bridge In node ${this.getNodeLabel(node)} must connect to a Function node before downstream modules.`,
          'MQTT_IN_REQUIRES_FUNCTION'
        );
      }

      const outputStep = this.buildOutputStepFromNode(targetNode);
      if (outputStep) {
        paths.push([outputStep]);
        continue;
      }

      if (this.isFunctionModule(targetModuleId)) {
        const functionStep = this.buildFunctionStepFromNode(targetNode);
        const downstreamPaths = this.buildPathsFromNode(
          targetNode,
          nodeById,
          outgoingEdgesByNode,
          nextVisited
        );

        if (!downstreamPaths.length) {
          this.throwNodeError(
            targetNode,
            `Function node ${this.getNodeLabel(targetNode)} has no valid downstream output.`,
            'FUNCTION_NODE_NO_VALID_OUTPUT'
          );
        }

        downstreamPaths.forEach((path) => {
          paths.push([functionStep, ...path]);
        });
        continue;
      }

      this.appendNodeWarning(
        targetNode,
        `Node ${this.getNodeLabel(targetNode)} with module ${targetModuleId} is not supported in server-side logic paths.`,
        'RUNTIME_LOGIC_NODE_UNSUPPORTED'
      );
    }

    return paths;
  }

  private buildInputStep(node: Node): RuntimeStep {
    return {
      id: node.id,
      moduleId: node.data?.moduleId ?? '',
      stepType: 'input',
      variables: node.data?.variables,
      channel:
        node.data?.moduleId === 'mqtt-in'
          ? this.normalizeMqttChannel(node.data?.variables?.channel)
          : undefined,
    };
  }

  private hasRuntimeOutputStep(path: RuntimeStep[]): boolean {
    return path.some(
      (step) => step.stepType === 'output' || step.stepType === 'mqtt-out'
    );
  }

  private buildLogicPathForInputNode(
    inputNode: Node,
    nodeById: Map<string, Node>,
    outgoingEdgesByNode: Map<string, RFEdge[]>
  ): RuntimeStep[][] {
    const downstreamPaths = this.buildPathsFromNode(
      inputNode,
      nodeById,
      outgoingEdgesByNode,
      new Set<string>()
    );

    return downstreamPaths
      .filter((path) => this.hasRuntimeOutputStep(path))
      .map((path) => [this.buildInputStep(inputNode), ...path]);
  }

  buildLogicCommandsFromGraph(
    nodes: Node[],
    edges: RFEdge[]
  ): CommandExtraction {
    this.validateFunctionNodes(nodes);
    this.warnFloatingFunctionNodes(nodes, edges);

    if (!nodes.length || !edges.length) {
      return { flows: [], warnings: this.collectNodeWarnings(nodes) };
    }

    const flows: RuntimeStep[][] = [];

    const nodeById = this.buildNodeByIdMap(nodes);
    const outgoingEdgesByNode = this.buildOutgoingEdgesMap(edges);

    for (const inputNode of nodes) {
      const inputModuleId = inputNode.data?.moduleId ?? '';
      if (!this.isInputModule(inputModuleId)) {
        continue;
      }

      const paths = this.buildLogicPathForInputNode(
        inputNode,
        nodeById,
        outgoingEdgesByNode
      );
      paths.forEach((path) => flows.push(path));
    }

    return { flows, warnings: this.collectNodeWarnings(nodes) };
  }
}
