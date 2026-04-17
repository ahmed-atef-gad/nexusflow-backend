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

const MODE_MAP: Record<string, number> = {
  INPUT: 1,
  OUTPUT: 3,
  INPUT_PULLUP: 5,
  OUTPUT_TOGGLE: 3,
  ANALOG: 1,
  PWM: 3,
  DAC: 3,
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
  DHT_READ: 0x30,
  FC28_READ: 0x31,
  RAIN_READ: 0x33,
  MQ2_READ: 0x34,
};

const INPUT_TOPIC_PREFIX = 'logic/input';

type OutputModuleType = 'pwm' | 'digital' | 'dac' | 'other';
type RuntimeStepType = 'input' | 'function' | 'output';

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
  warnings: string[];
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
};

export type CommandExtraction = {
  flows: RuntimeStep[][];
  warnings: string[];
};

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
        throw new BadRequestException(
          `Node ${targetNode?.data.alias || targetNode?.data.name} is connected to multiple nodes`
        );
      }
    }
  }

  buildSetupFromNodes(nodes: Node[]): SetupObject {
    const setupPins: Record<number, SetupItem> = {};
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
      if (
        module.moduleId.startsWith('ESP32-gpio-input') ||
        module.moduleId.startsWith('ESP32-gpio-output')
      ) {
        const pinNumber = this.toOptionalNumber(module.variables?.pinNumber);
        const pinModeStr = module?.pinMode;
        if (pinNumber !== undefined && pinModeStr) {
          const pinMode = MODE_MAP[pinModeStr];
          if (pinMode === undefined) {
            throw new BadRequestException(
              `Invalid pin configuration for ${module?.alias || module.name}`
            );
          }
          // Build setup item

          const setupItem: SetupItem = {
            cmd:
              pinNumber == 25 || pinNumber == 26
                ? CMD_MAP['SET_DAC']
                : CMD_MAP['SET_PIN_MODE'],
            pin: pinNumber,
            mode: pinMode,
          };
          // For outputs, set an initial value of 0
          if (module.moduleId === 'ESP32-gpio-output') {
            setupItem.value = 0;
          }
          // Deduplicate by pin (last definition wins)
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
                throw new BadRequestException(
                  `Unsupported module ${module?.alias || module.name}`
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
              default:
                throw new BadRequestException(
                  `Unsupported module ${module?.alias || module.name}`
                );
            }
            outputTask.commands!.push({
              cmd: cmd,
              pin: pinNumber,
              topic: `esp/${node.id}/response`,
            });
          }
        } else {
          throw new BadRequestException(
            `Missing configuration for node ${module?.alias || module.name}`
          );
        }
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
          throw new BadRequestException(
            `Missing trigger/echo pin configuration for ${module?.alias || module.name}`
          );
        }

        if (
          !module.moduleId.startsWith('Ultrasonic-Sensor') &&
          pinNumber === undefined
        ) {
          throw new BadRequestException(
            `Missing pin configuration for  ${module?.alias || module.name}`
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
        const analogPin = this.toOptionalNumber(module.variables?.analogPin);
        const digitalPin = this.toOptionalNumber(module.variables?.digitalPin);
        const isDigital = this.toBoolean(module.variables?.isDigital);
        const isAnalog = this.toBoolean(module.variables?.isAnalog);
        if (
          (isDigital && digitalPin !== undefined) ||
          (isAnalog && analogPin !== undefined)
        ) {
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
          throw new BadRequestException(
            `Missing pin configuration for ${module?.alias || module.name}`
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

  buildTopicsForUi(dedicatedMac?: string): TopicsData {
    const resolvedMac = this.normalizeMacAddress(dedicatedMac);
    return {
      commandTopic: resolvedMac ? `esp/${resolvedMac}/cmd` : 'esp/cmd',
      resetWifiTopic: resolvedMac
        ? `esp/${resolvedMac}/resetwifi`
        : 'esp/resetwifi',
      instantExecutionTopic: resolvedMac
        ? `esp/${resolvedMac}/instant`
        : 'esp/instant',
    };
  }

  buildUiFromNodes(
    nodes: Node[],
    edges: RFEdge[],
    deviceMac?: string
  ): UiItem[] {
    if (nodes.length === 0) {
      throw new BadRequestException('Flow must contain at least one node');
    }

    const uiElements: UiItem[] = [];
    const resolvedMac = this.normalizeMacAddress(deviceMac);
    const commandTopic = resolvedMac ? `esp/${resolvedMac}/cmd` : 'esp/cmd';
    const connectedOutputIds = new Set<string>(
      edges?.map((e) => e.target) ?? []
    );

    nodes.forEach((node) => {
      const module = node.data;

      if (module.moduleId.startsWith('logic-function')) {
        return; // Skip function nodes in UI generation
      }

      if (module.moduleId.startsWith('ESP32-gpio-output')) {
        const pinNumber = this.toOptionalNumber(module.variables?.pinNumber);
        if (pinNumber !== undefined) {
          uiElements.push({
            moduleId: module.moduleId,
            moduleName: module.name,
            alias: module.alias,
            pin: pinNumber,
            responseTopic: `esp/${node.id}/response`,
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
          throw new BadRequestException(
            `Missing pin configuration for ${module?.alias || module.name}`
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
          throw new BadRequestException(
            `Missing pin configuration for ${module?.alias || module.name}`
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
          throw new BadRequestException(
            `Missing trigger/echo pin configuration for ${module?.alias || module.name}`
          );
        }

        if (
          !module.moduleId.startsWith('Ultrasonic-Sensor') &&
          pinNumber === undefined
        ) {
          throw new BadRequestException(
            `Missing pin configuration for ${module?.alias || module.name}`
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
    } else if (moduleId.startsWith('ESP32-gpio-output')) {
      return 'digital';
    } else {
      return 'other';
    }
  }

  private isOutputModule(moduleId: string): boolean {
    return moduleId.startsWith('ESP32-gpio-output');
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

  private buildOutputStepFromNode(
    targetNode: Node,
    warnings: string[]
  ): RuntimeStep | null {
    const targetModuleId = targetNode.data?.moduleId ?? '';
    if (!this.isOutputModule(targetModuleId)) {
      return null;
    }

    const pin = this.toOptionalNumber(targetNode.data?.variables?.pinNumber);
    if (pin === undefined) {
      warnings.push(
        `Output node ${targetNode.id} is missing pinNumber and was skipped.`
      );
      return null;
    }

    const cmd = this.resolveOutputCommand(targetModuleId);
    if (cmd === undefined) {
      warnings.push(
        `Unsupported output module ${targetModuleId} on node ${targetNode.id}.`
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
      topic: `esp/${targetNode.id}/response`,
    };
  }

  private validateFunctionCode(code: string): string | null {
    return validateFunctionNodeCode(code, {
      maxCodeLength: this.functionNodeMaxCodeLength,
      maxAstNodes: this.functionNodeMaxAstNodes,
    });
  }

  private buildFunctionStepFromNode(
    node: Node,
    warnings: string[]
  ): RuntimeStep {
    const code = String(node.data?.variables?.code ?? '').trim();
    if (!code) {
      warnings.push(
        `Function node ${node.data?.alias || node.data.name} has no code. It will behave like "return msg;".`
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
      throw new BadRequestException(
        `Invalid function code in node ${node.data?.alias || node.data.name}: ${validationError}`
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
    warnings: string[],
    visited: Set<string>
  ): RuntimeStep[][] {
    if (visited.has(node.id)) {
      warnings.push(
        `Cycle detected at node ${node.id}. This path was skipped.`
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
        warnings.push(
          `Edge ${edge.id || `${edge.source}->${edge.target}`} references missing target node ${edge.target}.`
        );
        continue;
      }

      const targetModuleId = targetNode.data?.moduleId ?? '';
      const outputStep = this.buildOutputStepFromNode(targetNode, warnings);
      if (outputStep) {
        paths.push([outputStep]);
        continue;
      }

      if (this.isFunctionModule(targetModuleId)) {
        const functionStep = this.buildFunctionStepFromNode(
          targetNode,
          warnings
        );
        const downstreamPaths = this.buildPathsFromNode(
          targetNode,
          nodeById,
          outgoingEdgesByNode,
          warnings,
          nextVisited
        );

        if (!downstreamPaths.length) {
          warnings.push(
            `Function node ${targetNode.data?.alias || targetNode.data.name} has no valid downstream output.`
          );
          continue;
        }

        downstreamPaths.forEach((path) => {
          paths.push([functionStep, ...path]);
        });
        continue;
      }

      warnings.push(
        `Node ${targetNode.data?.alias || targetNode.data.name} with module ${targetModuleId} is not supported in server-side logic paths.`
      );
    }

    return paths;
  }

  private buildInputStep(node: Node): RuntimeStep {
    return {
      id: node.id,
      moduleId: node.data?.moduleId ?? '',
      stepType: 'input',
    };
  }

  private hasRuntimeOutputStep(path: RuntimeStep[]): boolean {
    return path.some((step) => step.stepType === 'output');
  }

  private buildLogicPathForInputNode(
    inputNode: Node,
    nodeById: Map<string, Node>,
    outgoingEdgesByNode: Map<string, RFEdge[]>,
    warnings: string[]
  ): RuntimeStep[][] {
    const downstreamPaths = this.buildPathsFromNode(
      inputNode,
      nodeById,
      outgoingEdgesByNode,
      warnings,
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
    if (!nodes.length || !edges.length) {
      return { flows: [], warnings: [] };
    }

    const warnings: string[] = [];
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
        outgoingEdgesByNode,
        warnings
      );
      paths.forEach((path) => flows.push(path));
    }

    return { flows, warnings };
  }
}
