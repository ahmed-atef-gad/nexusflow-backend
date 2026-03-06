/*
  FlowBuilderService
  Purpose: Convert a node-edge flow graph (from the frontend) into:
  - Setup items to initialize ESP32 pin modes and default values.
  - Executable command flows to be published over MQTT at runtime.

  Key responsibilities:
  - Map UI pin modes to protocol codes (MODE_MAP) and high-level actions to command bytes (CMD_MAP/CMD_*).
  - Derive linear paths from a directed graph; detect cycles and isolated nodes, emitting warnings.
  - Detect simple fan-out (one input → many GPIO outputs) and collapse it into a single multi-command step.
  - Deduplicate setup per pin (last definition wins).

  Main APIs:
  - buildSetupFromNodes(nodes): SetupItem[]
  - buildLogicCommandsFromGraph(nodes, edges): { flows: CommandStep[][], warnings: string[] }
  - (internal) buildFlowFromGraph(nodes, edges): { flows: FlowStep[][], warnings: string[] }

  Notes:
  - Each CommandStep has a reportTopic based on the node id for routing.
  - Output modules use "$prev" to reference the prior step's value.
*/
import { BadRequestException, Injectable } from '@nestjs/common';
import { Edge as RFEdge } from './types/flow.types';
import { Node } from './schemas/node.schema';
import { UiItem } from './schemas/uiItem.schema';
import { randomInt } from 'crypto';

const readEnvNumber = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
};

const MIN_INTERVAL_MS = readEnvNumber('MIN_INTERVAL_MS', 250);
const MAX_INTERVAL_MS = readEnvNumber('MAX_INTERVAL_MS', 60000);
const DEFAULT_GPIO_INTERVAL_MS = readEnvNumber(
  'DEFAULT_GPIO_INTERVAL_MS',
  1000
);
const DEFAULT_GPIO_OUTPUT_INTERVAL_MS = readEnvNumber(
  'DEFAULT_GPIO_OUTPUT_INTERVAL_MS',
  10000
);
const DEFAULT_SENSOR_INTERVAL_MS = readEnvNumber(
  'DEFAULT_SENSOR_INTERVAL_MS',
  5000
);
const DEFAULT_PIR_INTERVAL_MS = readEnvNumber('DEFAULT_PIR_INTERVAL_MS', 1000);

/**
 * Maps human-readable pin modes (from UI) to numeric protocol codes
 * used by the ESP32 firmware.
 */
const MODE_MAP: Record<string, number> = {
  INPUT: 1,
  OUTPUT: 3,
  INPUT_PULLUP: 5,
  OUTPUT_TOGGLE: 3,
  ANALOG: 1,
  PWM: 3,
  DAC: 3,
};

/**
 * Maps high-level command names to their byte codes as expected by
 * the device protocol during setup phase (e.g., set pin mode/value).
 */
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

/**
 * One-time setup instruction for a specific pin.
 */
export type SetupItem = {
  cmd: number;
  pin: number;
  mode: number;
  value?: number;
};

/**
 * A single logical node in a linearized flow path.
 * - `next` points to next node id in the path; null when terminal.
 * - `topic` is used for terminal MQTT nodes.
 */
export type FlowStep = {
  id: string;
  moduleId: string;
  variables?: Record<string, string | number | boolean>;
  next?: string | null;
  topic?: string;
};

/**
 * Result of extracting linear paths from a graph.
 */
export type FlowExtraction = {
  flows: FlowStep[][];
  warnings: string[];
};

/**
 * A single executable step that may contain one command (normal) or
 * a list of parallel commands (fan-out optimization).
 */
export type CommandStep = {
  id: string;
  moduleId: string;
  command?: {
    cmd: number;
    condition?: string;
    pin?: number;
    digtalPin?: number;
    analogPin?: number;
    value?: number | string;
    topic?: string;
  };
  commands?: Array<{
    condition?: string;
    cmd: number;
    pin?: number;
    value?: number | string;
    topic?: string;
  }>;
  reportTopic: string;
  next?: string | null;
};

/**
 * Result of converting linearized flows to executable command steps.
 */
export type CommandExtraction = {
  flows: CommandStep[][];
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

@Injectable()
export class FlowBuilderService {
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
    return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, normalized));
  }

  /**
   * Build device setup instructions from module nodes.
   * - Validates required variables (`pinNumber`, `pinMode`).
   * - Maps pin mode strings to protocol codes.
   * - Deduplicates by pin: the last encountered setup wins.
   *
   * @throws BadRequestException when node variables are missing or invalid.
   */
  buildSetupFromNodes(nodes: Node[]): {
    setup: SetupItem[];
    tasks: Array<Record<string, any>>;
  } {
    const setupPins: Record<number, SetupItem> = {};
    const gpioTask: Task = {
      taskName: 'GpioTask',
      intervalMs: DEFAULT_GPIO_INTERVAL_MS,
      commands: [],
    };
    const outputTask: Task = {
      taskName: 'GpioOutput',
      intervalMs: DEFAULT_GPIO_OUTPUT_INTERVAL_MS,
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
                DEFAULT_GPIO_INTERVAL_MS
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
              topic: `esp/${node.id}`,
            });
          } else if (module.moduleId.startsWith('ESP32-gpio-output')) {
            const moduleInterval = this.toOptionalNumber(
              module.variables?.intervalMs
            );
            if (moduleInterval !== undefined) {
              const effectiveInterval = this.resolveInterval(
                moduleInterval,
                DEFAULT_GPIO_OUTPUT_INTERVAL_MS
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

      if (module.moduleId.startsWith('DHT-Sensor')) {
        const pinNumber = this.toOptionalNumber(module.variables?.pinNumber);
        if (pinNumber !== undefined) {
          // Add to DHT sensors task
          if (!sensorsTask['DHT']) {
            sensorsTask['DHT'] = [];
          }
          const taskName = this.generateTaskName(module.moduleId, pinNumber);
          const type = module.moduleId === 'DHT-Sensor-11' ? 11 : 22;
          sensorsTask['DHT'].push({
            taskName,
            intervalMs: this.resolveInterval(
              module.variables?.intervalMs,
              DEFAULT_SENSOR_INTERVAL_MS
            ),
            topic: `esp/${node.id}`,
            pin: pinNumber,
            type,
          });
        } else {
          throw new BadRequestException(
            `Missing pin configuration for  ${module?.alias || module.name}`
          );
        }
      }
      if (module.moduleId.startsWith('PIR-Sensor')) {
        const pinNumber = this.toOptionalNumber(module.variables?.pinNumber);
        if (pinNumber !== undefined) {
          if (!sensorsTask['PIR']) {
            sensorsTask['PIR'] = [];
          }
          const taskName = this.generateTaskName(module.moduleId, pinNumber);
          sensorsTask['PIR'].push({
            taskName,
            intervalMs: this.resolveInterval(
              module.variables?.intervalMs,
              DEFAULT_PIR_INTERVAL_MS
            ),
            topic: `esp/${node.id}`,
            pin: pinNumber,
          });
        } else {
          throw new BadRequestException(
            `Missing pin configuration for  ${module?.alias || module.name}`
          );
        }
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
              DEFAULT_SENSOR_INTERVAL_MS
            ),
            topic: `esp/${node.id}`,
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

  buildUiFromNodes(nodes: Node[], deviceMac?: string): UiItem[] {
    const uiElements: UiItem[] = [];
    const resolvedMac = this.normalizeMacAddress(deviceMac);
    const commandTopic = resolvedMac ? `esp/${resolvedMac}/cmd` : 'esp/cmd';

    nodes.forEach((node) => {
      const module = node.data;
      if (module.moduleId.startsWith('ESP32-gpio-output')) {
        const pinNumber = module.variables?.pinNumber;
        if (pinNumber !== undefined) {
          uiElements.push({
            moduleId: module.moduleId,
            moduleName: module.name,
            alias: module.alias,
            pin: pinNumber,
            responseTopic: `esp/${node.id}/response`,
            moduleType: 'output',
            topic: commandTopic,
          });
        }
        return;
      }

      if (
        module.moduleId.startsWith('MQ2-Sensor') ||
        module.moduleId.startsWith('Rain-Sensor') ||
        module.moduleId.startsWith('Soil-Sensor')
      ) {
        const isDigital = module.variables?.isDigital;
        const isAnalog = module.variables?.isAnalog;

        const digitalPin = module.variables?.digitalPin;
        const analogPin = module.variables?.analogPin;

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
          moduleType: 'input',
          topic: `esp/${node.id}`,
          pin: isDigital ? digitalPin : analogPin,
          digitalPin,
          analogPin,
          isDigital,
          isAnalog,
        });
        return;
      }

      if (
        module.moduleId.startsWith('DHT-Sensor') ||
        module.moduleId.startsWith('PIR-Sensor')
      ) {
        const pinNumber = module.variables?.pinNumber;
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
          topic: `esp/${node.id}`,
        });
      } else {
        uiElements.push({
          moduleId: module.moduleId,
          moduleName: module.name,
          alias: module.alias,
          moduleType: 'input',
          topic: `esp/${node.id}`,
        });
      }
    });
    return uiElements;
  }

  private normalizeMacAddress(macAddress?: string): string | undefined {
    if (!macAddress) return undefined;
    const trimmed = macAddress.trim();
    if (!trimmed) return undefined;
    return trimmed.toUpperCase();
  }

  /**
   * Convert a graph of nodes and edges into executable command steps.
   * Steps are grouped per linear path; simple fan-outs (one input → many
   * outputs) are collapsed into a single multi-command step to reduce
   * round-trips.
   *
   * Mapping rules:
   * - ESP32-gpio-input: read (analog or digital) from configured pin.
   * - ESP32-gpio-output: write `$prev` (prior step's value) to pin; PWM/DAC use analog write; OUTPUT_TOGGLE uses toggle when `$prev === 1`.
   * - MQTT-publish: no device command; included for chaining/reporting only.
   */
  buildLogicCommandsFromGraph(
    nodes: Node[],
    edges: RFEdge[]
  ): CommandExtraction {
    //   const { flows: linear, warnings } = this.buildFlowFromGraph(nodes, edges);
    //   const mapStep = (s: FlowStep): CommandStep => {
    //     // Topic should be the node id to uniquely route results per node
    //     const topic = `esp/${s.id}`;
    //     // infer command by module id
    //     const vars = s.variables || {};
    //     const pin = vars['pinNumber'] ? Number(vars['pinNumber']) : undefined;
    //     const pinMode = vars['pinMode'];
    //     let command: CommandStep['command'] | undefined;
    //     switch (s.moduleId) {
    //       case 'ESP32-gpio-input': {
    //         if (pin !== undefined) {
    //           const isAnalog = pinMode === 'ANALOG';
    //           command = {
    //             cmd: isAnalog ? CMD_MAP['ANALOG_READ'] : CMD_MAP['GET_PIN_VALUE'],
    //             pin,
    //             topic,
    //           };
    //         }
    //         break;
    //       }
    //       case 'ESP32-gpio-output': {
    //         if (pin !== undefined) {
    //           // Value is taken from previous step result at runtime
    //           if (pinMode === 'PWM' || pinMode === 'DAC') {
    //             command = {
    //               cmd:
    //                 pinMode === 'PWM'
    //                   ? CMD_MAP['ANALOG_WRITE']
    //                   : CMD_MAP['DAC_WRITE'],
    //               pin,
    //               value: '$prev',
    //               topic,
    //             };
    //           } else {
    //             command = {
    //               cmd: CMD_MAP['SET_PIN_VALUE'],
    //               pin,
    //               value: '$prev',
    //               topic,
    //             };
    //           }
    //         }
    //         break;
    //       }
    //       case 'MQTT-publish': {
    //         // Not an ESP pin command; use report topic only. Frontend can handle publish side.
    //         command = undefined;
    //         break;
    //       }
    //       default: {
    //         // Unknown module; emit no command, still chain via next and topic
    //         command = undefined;
    //       }
    //     }
    //     return {
    //       id: s.id,
    //       moduleId: s.moduleId,
    //       command,
    //       reportTopic: topic,
    //       next: s.next ?? null,
    //     };
    //   };
    //   // Group linear paths that represent a simple fan-out: [input] -> [output]
    //   const byFirst: Map<string, FlowStep[][]> = new Map();
    //   for (const p of linear) {
    //     if (p.length >= 2) {
    //       const key = p[0].id;
    //       if (!byFirst.has(key)) byFirst.set(key, []);
    //       byFirst.get(key)!.push(p);
    //     }
    //   }
    //   const groupedFirstIds = new Set<string>();
    //   const outFlows: CommandStep[][] = [];
    //   for (const [firstId, paths] of byFirst.entries()) {
    //     const allAreFanout =
    //       paths.length > 1 &&
    //       paths.every(
    //         (p) => p.length === 2 && p[1].moduleId === 'ESP32-gpio-output'
    //       );
    //     if (!allAreFanout) continue;
    //     groupedFirstIds.add(firstId);
    //     const first = paths[0][0];
    //     const firstCmd = mapStep(first);
    //     const fanOutCommands: NonNullable<CommandStep['commands']> = [];
    //     for (const p of paths) {
    //       const out = p[1];
    //       const vars = out.variables || {};
    //       const pin = vars['pinNumber'] ? Number(vars['pinNumber']) : undefined;
    //       const pinMode = vars['pinMode'];
    //       if (pin === undefined) continue;
    //       if (pinMode === 'PWM' || pinMode === 'DAC') {
    //         fanOutCommands.push({
    //           cmd: CMD_MAP['ANALOG_WRITE'],
    //           pin,
    //           value: '$prev',
    //           topic: out.id,
    //         });
    //       } else if (pinMode === 'OUTPUT_TOGGLE') {
    //         fanOutCommands.push({
    //           condition: '$prev === 1',
    //           cmd: CMD_MAP['TOGGLE_PIN_VALUE'],
    //           pin,
    //           topic: out.id,
    //         });
    //       } else {
    //         fanOutCommands.push({
    //           cmd: CMD_MAP['SET_PIN_VALUE'],
    //           pin,
    //           value: '$prev',
    //           topic: out.id,
    //         });
    //       }
    //     }
    //     const fanOutStep: CommandStep = {
    //       id: `${first.id}::fanout`,
    //       moduleId: 'fanout',
    //       commands: fanOutCommands,
    //       reportTopic: `${first.id}::fanout`,
    //       next: null,
    //     };
    //     outFlows.push([firstCmd, fanOutStep]);
    //   }
    //   for (const p of linear) {
    //     if (p.length >= 2 && groupedFirstIds.has(p[0].id)) continue; // already included in grouped
    //     outFlows.push(p.map(mapStep));
    //   }
    //   return { flows: outFlows, warnings };
    // }
    // /**
    //  * Extract linear flow paths from a directed graph.
    //  * - Identifies start nodes (in-degree 0 and out-degree > 0).
    //  * - DFS traverses successors; records a path for each terminal or branch.
    //  * - Detects cycles, emitting warnings and cutting the path.
    //  * - Includes isolated nodes as single-step flows.
    //  */
    // private buildFlowFromGraph(nodes: Node[], edges: RFEdge[]): FlowExtraction {
    //   const warnings: string[] = [];
    //   // Map node id → node for O(1) lookup
    //   const nodeMap = new Map<string, Node>();
    //   for (const n of nodes) nodeMap.set(n.id, n);
    //   // Build adjacency lists for outgoing and incoming edges
    //   const outgoing = new Map<string, string[]>();
    //   const incoming = new Map<string, string[]>();
    //   for (const e of edges) {
    //     if (!e.source || !e.target) continue;
    //     if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    //     outgoing.get(e.source)!.push(e.target);
    //     if (!incoming.has(e.target)) incoming.set(e.target, []);
    //     incoming.get(e.target)!.push(e.source);
    //   }
    //   // Detect start nodes: no incoming, at least one outgoing
    //   const starts: string[] = [];
    //   for (const n of nodes) {
    //     const inDeg = (incoming.get(n.id) || []).length;
    //     const outDeg = (outgoing.get(n.id) || []).length;
    //     if (inDeg === 0 && outDeg > 0) {
    //       starts.push(n.id);
    //     }
    //   }
    //   const flows: FlowStep[][] = [];
    //   // Convert a ModuleNode to a basic FlowStep template
    //   const getStep = (n: Node): FlowStep => {
    //     const data = n.data;
    //     // Normalize pin mode onto variables so downstream command mapping sees it
    //     const pinMode = data?.pinMode;
    //     return {
    //       id: n.id,
    //       moduleId: data.moduleId,
    //       variables: {
    //         ...data.variables,
    //         ...(pinMode ? { pinMode } : {}),
    //       },
    //     };
    //   };
    //   // Deterministic traversal order
    //   const outsOf = (id: string): string[] =>
    //     (outgoing.get(id) || []).slice().sort();
    //   // Terminal when module is MQTT-publish (publishes to topic and stops)
    //   const isTerminalMqtt = (n: Node) => n.data.id === 'MQTT-publish';
    //   // Depth-first traversal, cloning path and visited per branch
    //   const dfs = (
    //     currentId: string,
    //     pathSoFar: FlowStep[],
    //     visited: Set<string>
    //   ) => {
    //     if (visited.has(currentId)) {
    //       warnings.push(`Detected cycle at node ${currentId}; stopping path.`);
    //       if (pathSoFar.length) flows.push(pathSoFar);
    //       return;
    //     }
    //     const n = nodeMap.get(currentId);
    //     if (!n) {
    //       if (pathSoFar.length) flows.push(pathSoFar);
    //       return;
    //     }
    //     const outs = outsOf(currentId);
    //     const stepBase = getStep(n);
    //     if (isTerminalMqtt(n)) {
    //       const step: FlowStep = {
    //         ...stepBase,
    //         next: null,
    //         topic: n.data.variables?.['topic'] || n.data.alias || 'esp/cmd',
    //       };
    //       flows.push([...pathSoFar, step]);
    //       return;
    //     }
    //     if (outs.length === 0) {
    //       const step: FlowStep = { ...stepBase, next: null };
    //       flows.push([...pathSoFar, step]);
    //       return;
    //     }
    //     if (outs.length > 1) {
    //       warnings.push(
    //         `Node ${currentId} has ${outs.length} outgoing edges; creating branches.`
    //       );
    //     }
    //     for (const nextId of outs) {
    //       const step: FlowStep = { ...stepBase, next: nextId };
    //       const nextPath = [...pathSoFar, step];
    //       const nextVisited = new Set(visited);
    //       nextVisited.add(currentId);
    //       dfs(nextId, nextPath, nextVisited);
    //     }
    //   };
    //   // Start DFS from each start node
    //   for (const startId of starts) {
    //     dfs(startId, [], new Set<string>());
    //   }
    //   // Include isolated nodes (no incoming and no outgoing)
    //   for (const n of nodes) {
    //     const id = n.id;
    //     const inDeg = (incoming.get(id) || []).length;
    //     const outDeg = (outgoing.get(id) || []).length;
    //     if (inDeg === 0 && outDeg === 0) {
    //       const step = getStep(n);
    //       if (isTerminalMqtt(n)) {
    //         step.topic = n.data.variables?.['topic'] || n.data.alias || 'esp/cmd';
    //       }
    //       flows.push([step]);
    //     }
    //   }
    //   return { flows, warnings };
    return { flows: [], warnings: ['Flow extraction not implemented yet.'] };
  }
}
