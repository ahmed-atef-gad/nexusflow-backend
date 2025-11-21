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
import { ModuleNode, Edge as RFEdge } from './types/flow.types';

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
  SET_PIN_MODE: 0x10,
  SET_PIN_VALUE: 0x11,
  GET_PIN_VALUE: 0x12,
  TOGGLE_PIN_VALUE: 0x13,
  ANALOG_READ: 0x20,
  ANALOG_WRITE: 0x21,
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
  variables?: Record<string, string>;
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

@Injectable()
export class FlowBuilderService {
  /**
   * Build device setup instructions from module nodes.
   * - Validates required variables (`pinNumber`, `pinMode`).
   * - Maps pin mode strings to protocol codes.
   * - Deduplicates by pin: the last encountered setup wins.
   *
   * @throws BadRequestException when node variables are missing or invalid.
   */
  buildSetupFromNodes(nodes: ModuleNode[]): SetupItem[] {
    const setupMap: Record<number, SetupItem> = {};
    nodes.forEach((node) => {
      const module = node.data;
      if (
        module.id === 'ESP32-gpio-input' ||
        module.id === 'ESP32-gpio-output'
      ) {
        const pinNumberStr = module.variables?.['pinNumber'];
        const pinModeStr = module.variables?.['pinMode'];
        if (pinNumberStr && pinModeStr) {
          const pinNumber = parseInt(pinNumberStr, 10);
          const pinMode = MODE_MAP[pinModeStr];
          if (isNaN(pinNumber) || pinMode === undefined) {
            throw new BadRequestException(
              `Invalid pin configuration for node ${node.id}`
            );
          }
          // Build setup item
          const setupItem: SetupItem = {
            cmd: CMD_MAP['SET_PIN_MODE'],
            pin: pinNumber,
            mode: pinMode,
          };
          // For outputs, set an initial value of 0
          if (module.id === 'ESP32-gpio-output') {
            setupItem.value = 0;
          }
          // Deduplicate by pin (last definition wins)
          setupMap[pinNumber] = setupItem;
        } else {
          throw new BadRequestException(
            `Missing pin configuration for node ${node.id}`
          );
        }
      }
    });
    // TODO: Replace console.log with NestJS Logger for structured logs
    console.log('Final setup map:', setupMap);

    return Object.values(setupMap);
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
    nodes: ModuleNode[],
    edges: RFEdge[]
  ): CommandExtraction {
    const { flows: linear, warnings } = this.buildFlowFromGraph(nodes, edges);

    const mapStep = (s: FlowStep): CommandStep => {
      // Topic should be the node id to uniquely route results per node
      const topic = s.id;
      // infer command by module id
      const vars = s.variables || {};
      const pin = vars['pinNumber'] ? Number(vars['pinNumber']) : undefined;
      const pinMode = vars['pinMode'];
      let command: CommandStep['command'] | undefined;

      switch (s.moduleId) {
        case 'ESP32-gpio-input': {
          if (pin !== undefined) {
            const isAnalog = pinMode === 'ANALOG';
            command = {
              cmd: isAnalog ? CMD_MAP['ANALOG_READ'] : CMD_MAP['GET_PIN_VALUE'],
              pin,
              topic,
            };
          }
          break;
        }
        case 'ESP32-gpio-output': {
          if (pin !== undefined) {
            // Value is taken from previous step result at runtime
            if (pinMode === 'PWM' || pinMode === 'DAC') {
              command = {
                cmd: CMD_MAP['ANALOG_WRITE'],
                pin,
                value: '$prev',
                topic,
              };
            } else {
              command = {
                cmd: CMD_MAP['SET_PIN_VALUE'],
                pin,
                value: '$prev',
                topic,
              };
            }
          }
          break;
        }
        case 'MQTT-publish': {
          // Not an ESP pin command; use report topic only. Frontend can handle publish side.
          command = undefined;
          break;
        }
        default: {
          // Unknown module; emit no command, still chain via next and topic
          command = undefined;
        }
      }

      return {
        id: s.id,
        moduleId: s.moduleId,
        command,
        reportTopic: topic,
        next: s.next ?? null,
      };
    };

    // Group linear paths that represent a simple fan-out: [input] -> [output]
    const byFirst: Map<string, FlowStep[][]> = new Map();
    for (const p of linear) {
      if (p.length >= 2) {
        const key = p[0].id;
        if (!byFirst.has(key)) byFirst.set(key, []);
        byFirst.get(key)!.push(p);
      }
    }

    const groupedFirstIds = new Set<string>();
    const outFlows: CommandStep[][] = [];

    for (const [firstId, paths] of byFirst.entries()) {
      const allAreFanout =
        paths.length > 1 &&
        paths.every(
          (p) => p.length === 2 && p[1].moduleId === 'ESP32-gpio-output'
        );
      if (!allAreFanout) continue;

      groupedFirstIds.add(firstId);
      const first = paths[0][0];
      const firstCmd = mapStep(first);

      const fanOutCommands: NonNullable<CommandStep['commands']> = [];
      for (const p of paths) {
        const out = p[1];
        const vars = out.variables || {};
        const pin = vars['pinNumber'] ? Number(vars['pinNumber']) : undefined;
        const pinMode = vars['pinMode'];
        if (pin === undefined) continue;
        if (pinMode === 'PWM' || pinMode === 'DAC') {
          fanOutCommands.push({
            cmd: CMD_MAP['ANALOG_WRITE'],
            pin,
            value: '$prev',
            topic: out.id,
          });
        } else if (pinMode === 'OUTPUT_TOGGLE') {
          fanOutCommands.push({
            condition: '$prev === 1',
            cmd: CMD_MAP['TOGGLE_PIN_VALUE'],
            pin,
            topic: out.id,
          });
        } else {
          fanOutCommands.push({
            cmd: CMD_MAP['SET_PIN_VALUE'],
            pin,
            value: '$prev',
            topic: out.id,
          });
        }
      }

      const fanOutStep: CommandStep = {
        id: `${first.id}::fanout`,
        moduleId: 'fanout',
        commands: fanOutCommands,
        reportTopic: `${first.id}::fanout`,
        next: null,
      };

      outFlows.push([firstCmd, fanOutStep]);
    }

    for (const p of linear) {
      if (p.length >= 2 && groupedFirstIds.has(p[0].id)) continue; // already included in grouped
      outFlows.push(p.map(mapStep));
    }

    return { flows: outFlows, warnings };
  }

  /**
   * Extract linear flow paths from a directed graph.
   * - Identifies start nodes (in-degree 0 and out-degree > 0).
   * - DFS traverses successors; records a path for each terminal or branch.
   * - Detects cycles, emitting warnings and cutting the path.
   * - Includes isolated nodes as single-step flows.
   */
  private buildFlowFromGraph(
    nodes: ModuleNode[],
    edges: RFEdge[]
  ): FlowExtraction {
    const warnings: string[] = [];
    // Map node id → node for O(1) lookup
    const nodeMap = new Map<string, ModuleNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    // Build adjacency lists for outgoing and incoming edges
    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();
    for (const e of edges) {
      if (!e.source || !e.target) continue;

      if (!outgoing.has(e.source)) outgoing.set(e.source, []);

      outgoing.get(e.source)!.push(e.target);

      if (!incoming.has(e.target)) incoming.set(e.target, []);

      incoming.get(e.target)!.push(e.source);
    }

    // Detect start nodes: no incoming, at least one outgoing
    const starts: string[] = [];
    for (const n of nodes) {
      const inDeg = (incoming.get(n.id) || []).length;
      const outDeg = (outgoing.get(n.id) || []).length;
      if (inDeg === 0 && outDeg > 0) {
        starts.push(n.id);
      }
    }

    const flows: FlowStep[][] = [];

    // Convert a ModuleNode to a basic FlowStep template
    const getStep = (n: ModuleNode): FlowStep => {
      const data = n.data;
      return {
        id: n.id,
        moduleId: data.id,
        variables: data.variables,
      };
    };

    // Deterministic traversal order
    const outsOf = (id: string): string[] =>
      (outgoing.get(id) || []).slice().sort();

    // Terminal when module is MQTT-publish (publishes to topic and stops)
    const isTerminalMqtt = (n: ModuleNode) => n.data.id === 'MQTT-publish';

    // Depth-first traversal, cloning path and visited per branch
    const dfs = (
      currentId: string,
      pathSoFar: FlowStep[],
      visited: Set<string>
    ) => {
      if (visited.has(currentId)) {
        warnings.push(`Detected cycle at node ${currentId}; stopping path.`);
        if (pathSoFar.length) flows.push(pathSoFar);
        return;
      }
      const n = nodeMap.get(currentId);
      if (!n) {
        if (pathSoFar.length) flows.push(pathSoFar);
        return;
      }

      const outs = outsOf(currentId);
      const stepBase = getStep(n);

      if (isTerminalMqtt(n)) {
        const step: FlowStep = {
          ...stepBase,
          next: null,
          topic: n.data.variables?.['topic'] || n.data.alias || 'esp/cmd',
        };
        flows.push([...pathSoFar, step]);
        return;
      }

      if (outs.length === 0) {
        const step: FlowStep = { ...stepBase, next: null };
        flows.push([...pathSoFar, step]);
        return;
      }

      if (outs.length > 1) {
        warnings.push(
          `Node ${currentId} has ${outs.length} outgoing edges; creating branches.`
        );
      }

      for (const nextId of outs) {
        const step: FlowStep = { ...stepBase, next: nextId };
        const nextPath = [...pathSoFar, step];
        const nextVisited = new Set(visited);
        nextVisited.add(currentId);
        dfs(nextId, nextPath, nextVisited);
      }
    };

    // Start DFS from each start node
    for (const startId of starts) {
      dfs(startId, [], new Set<string>());
    }

    // Include isolated nodes (no incoming and no outgoing)
    for (const n of nodes) {
      const id = n.id;
      const inDeg = (incoming.get(id) || []).length;
      const outDeg = (outgoing.get(id) || []).length;
      if (inDeg === 0 && outDeg === 0) {
        const step = getStep(n);
        if (isTerminalMqtt(n)) {
          step.topic = n.data.variables?.['topic'] || n.data.alias || 'esp/cmd';
        }
        flows.push([step]);
      }
    }
    // TODO: Replace console.log with NestJS Logger for structured logs
    console.log(flows);

    return { flows, warnings };
  }
}
