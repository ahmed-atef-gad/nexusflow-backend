import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Logic, LogicDocument } from './schemas/logic.schema';
import { LogicPayload } from './types/flow.types';
import {
  CommandExtraction,
  FlowNodeDiagnostic,
  RuntimeStep,
} from './flow-builder.service';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import {
  DEFAULT_FUNCTION_NODE_MAX_AST_NODES,
  DEFAULT_FUNCTION_NODE_MAX_CODE_LENGTH,
  validateFunctionNodeCode,
} from './function-node-security.util';
import { DevicesService } from 'src/devices/devices.service';

const MAX_RUNTIME_FLOW_PATHS = 500;
const MAX_RUNTIME_STEPS_PER_PATH = 64;
const MAX_RUNTIME_FUNCTION_STEPS_PER_PATH = 16;
const MAX_FUNCTION_VALIDATION_CACHE_SIZE = 500;
const DEFAULT_MQTT_LOGIC_CACHE_TTL_MS = 300000; // 5 minutes

// Cache key namespaces
const LOGIC_FLOWS_NS = 'logic:flows:';

interface LogicFlowCacheEntry {
  flowId: string;
  flows: RuntimeStep[][];
}

interface LogicProgramProjection {
  program?: CommandExtraction;
}

@Injectable()
export class LogicService {
  private readonly functionNodeMaxCodeLength: number;
  private readonly functionNodeMaxAstNodes: number;
  private readonly logicCacheTtlMs: number;

  constructor(
    @InjectModel(Logic.name) private logicModel: Model<LogicDocument>,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => DevicesService))
    private readonly devicesService: DevicesService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache
  ) {
    this.functionNodeMaxCodeLength = this.readPositiveConfigNumber(
      'FUNCTION_NODE_MAX_CODE_LENGTH',
      DEFAULT_FUNCTION_NODE_MAX_CODE_LENGTH
    );
    this.functionNodeMaxAstNodes = this.readPositiveConfigNumber(
      'FUNCTION_NODE_MAX_AST_NODES',
      DEFAULT_FUNCTION_NODE_MAX_AST_NODES
    );
    this.logicCacheTtlMs = this.readPositiveConfigNumber(
      'MQTT_LOGIC_CACHE_TTL_MS',
      DEFAULT_MQTT_LOGIC_CACHE_TTL_MS
    );
  }

  private buildLogicCacheKey(deviceMac: string): string {
    return (deviceMac ?? '').toString().trim().toUpperCase();
  }

  evictForDevice(deviceMac: string): void {
    if (!deviceMac) return;
    const key =
      LOGIC_FLOWS_NS +
      (deviceMac === '*' ? '*' : this.buildLogicCacheKey(deviceMac));
    if (deviceMac === '*') {
      void this.cacheManager.clear();
    }
    void this.cacheManager.del(key);
  }

  validateFunctionCodeAtRuntime(code: string): string | null {
    return this.validateFunctionCodeSync(code);
  }

  private readonly _fnValidationLocalCache = new Map<string, string | null>();

  private validateFunctionCodeSync(code: string): string | null {
    if (this._fnValidationLocalCache.has(code)) {
      const cached = this._fnValidationLocalCache.get(code) ?? null;
      if (
        cached === "'mapValue' is not defined" &&
        /\bmapValue\s*\(/.test(code)
      ) {
        this._fnValidationLocalCache.delete(code);
      } else {
        return cached;
      }
    }

    const validationError = validateFunctionNodeCode(code, {
      maxCodeLength: this.functionNodeMaxCodeLength,
      maxAstNodes: this.functionNodeMaxAstNodes,
    });

    if (
      this._fnValidationLocalCache.size >= MAX_FUNCTION_VALIDATION_CACHE_SIZE
    ) {
      this._fnValidationLocalCache.clear();
    }

    this._fnValidationLocalCache.set(code, validationError);
    return validationError;
  }

  async getLogicFlowsForFlowId(
    flowId: string,
    deviceMac: string
  ): Promise<RuntimeStep[][]> {
    const cacheKey = LOGIC_FLOWS_NS + this.buildLogicCacheKey(deviceMac);
    const cachedEntry =
      await this.cacheManager.get<LogicFlowCacheEntry>(cacheKey);

    if (cachedEntry && cachedEntry.flowId === flowId) {
      return cachedEntry.flows;
    }

    const logicDoc = await this.logicModel
      .findOne({ flowId })
      .select('program')
      .lean<LogicProgramProjection>()
      .exec();

    const rawFlows = Array.isArray(logicDoc?.program?.flows)
      ? logicDoc.program.flows
      : [];
    const safeFlows = rawFlows.filter(Array.isArray) as RuntimeStep[][];

    await this.cacheManager.set(
      cacheKey,
      { flowId, flows: safeFlows },
      this.logicCacheTtlMs
    );
    return safeFlows;
  }

  private readPositiveConfigNumber(name: string, fallback: number): number {
    const raw = this.configService.get<string | number>(name);
    if (raw === undefined || raw === null || raw === '') return fallback;

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.trunc(parsed);
  }

  private ensureNonEmptyString(
    value: string | undefined,
    fieldName: string
  ): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${fieldName} must be a non-empty string`);
    }
    return value.trim();
  }

  private sanitizeFunctionCode(
    code: string | undefined,
    pathIndex: number,
    stepIndex: number
  ): string {
    const normalizedCode = typeof code === 'string' ? code.trim() : '';
    const functionCode = normalizedCode || 'return msg;';

    const validationError = validateFunctionNodeCode(functionCode, {
      maxCodeLength: this.functionNodeMaxCodeLength,
      maxAstNodes: this.functionNodeMaxAstNodes,
    });

    if (validationError) {
      throw new BadRequestException(
        `Invalid function code at path ${pathIndex}, step ${stepIndex}: ${validationError}`
      );
    }

    return functionCode;
  }

  private sanitizeRuntimeStep(
    stepRaw: Partial<RuntimeStep>,
    pathIndex: number,
    stepIndex: number
  ): RuntimeStep {
    if (!stepRaw || typeof stepRaw !== 'object') {
      throw new BadRequestException(
        `Runtime step at path ${pathIndex}, index ${stepIndex} is invalid`
      );
    }

    const step = stepRaw;
    const id = this.ensureNonEmptyString(
      step.id,
      `program.flows[${pathIndex}][${stepIndex}].id`
    );
    const moduleId = this.ensureNonEmptyString(
      step.moduleId,
      `program.flows[${pathIndex}][${stepIndex}].moduleId`
    );

    if (
      step.stepType !== 'input' &&
      step.stepType !== 'function' &&
      step.stepType !== 'output' &&
      step.stepType !== 'mqtt-out'
    ) {
      throw new BadRequestException(
        `Invalid stepType at path ${pathIndex}, index ${stepIndex}`
      );
    }

    if (step.stepType === 'input') {
      return {
        id,
        moduleId,
        stepType: 'input',
        variables:
          step.variables && typeof step.variables === 'object'
            ? step.variables
            : undefined,
        channel: typeof step.channel === 'string' ? step.channel : undefined,
        skip: typeof step.skip === 'boolean' ? step.skip : undefined,
      };
    }

    if (step.stepType === 'function') {
      return {
        id,
        moduleId,
        stepType: 'function',
        code: this.sanitizeFunctionCode(step.code, pathIndex, stepIndex),
      };
    }

    if (step.stepType === 'mqtt-out') {
      return {
        id,
        moduleId,
        stepType: 'mqtt-out',
        channel: typeof step.channel === 'string' ? step.channel : 'default',
        targetFlowIds: Array.isArray(step.targetFlowIds)
          ? step.targetFlowIds
              .map((flowId) => String(flowId).trim())
              .filter(Boolean)
          : [],
      };
    }

    if (
      typeof step.cmd !== 'number' ||
      !Number.isFinite(step.cmd) ||
      typeof step.pin !== 'number' ||
      !Number.isFinite(step.pin)
    ) {
      throw new BadRequestException(
        `Output step at path ${pathIndex}, index ${stepIndex} must include numeric cmd and pin`
      );
    }

    const outputStep: RuntimeStep = {
      id,
      moduleId,
      stepType: 'output',
      cmd: Math.trunc(step.cmd),
      pin: Math.trunc(step.pin),
      value: step.value,
      topic: typeof step.topic === 'string' ? step.topic : undefined,
      targetModuleType:
        step.targetModuleType === 'digital' ||
        step.targetModuleType === 'pwm' ||
        step.targetModuleType === 'dac' ||
        step.targetModuleType === 'servo' ||
        step.targetModuleType === 'other'
          ? step.targetModuleType
          : undefined,
    };

    return outputStep;
  }

  private sanitizeProgram(
    programRaw: Partial<CommandExtraction>
  ): CommandExtraction {
    if (!programRaw || typeof programRaw !== 'object') {
      throw new BadRequestException('program must be an object');
    }

    const program = programRaw;
    if (!Array.isArray(program.flows)) {
      throw new BadRequestException('program.flows must be an array');
    }
    if (program.flows.length > MAX_RUNTIME_FLOW_PATHS) {
      throw new BadRequestException(
        `program.flows exceeds maximum allowed paths (${MAX_RUNTIME_FLOW_PATHS})`
      );
    }

    const sanitizedFlows = program.flows.map((flowRaw, pathIndex) => {
      if (!Array.isArray(flowRaw) || !flowRaw.length) {
        throw new BadRequestException(
          `program.flows[${pathIndex}] must be a non-empty array`
        );
      }
      if (flowRaw.length > MAX_RUNTIME_STEPS_PER_PATH) {
        throw new BadRequestException(
          `program.flows[${pathIndex}] exceeds maximum steps (${MAX_RUNTIME_STEPS_PER_PATH})`
        );
      }

      const sanitizedPath = flowRaw.map((stepRaw, stepIndex) =>
        this.sanitizeRuntimeStep(
          stepRaw as Partial<RuntimeStep>,
          pathIndex,
          stepIndex
        )
      );

      const functionStepsInPath = sanitizedPath.reduce((count, step) => {
        return step.stepType === 'function' ? count + 1 : count;
      }, 0);
      if (functionStepsInPath > MAX_RUNTIME_FUNCTION_STEPS_PER_PATH) {
        throw new BadRequestException(
          `program.flows[${pathIndex}] exceeds maximum function steps (${MAX_RUNTIME_FUNCTION_STEPS_PER_PATH})`
        );
      }

      if (sanitizedPath[0]?.stepType !== 'input') {
        throw new BadRequestException(
          `program.flows[${pathIndex}] must start with an input step`
        );
      }
      const terminalStepType =
        sanitizedPath[sanitizedPath.length - 1]?.stepType;

      // Prevent flow bridge loops at build/validation time: disallow paths
      // that originate from a Flow Bridge In (`mqtt-in`) and terminate at
      // a Flow Bridge Out (`mqtt-out`). Runtime hop-count guarding still
      // exists, but blocking these paths early avoids wasting runtime
      // resources and makes intent clearer to users.
      const firstModuleId = sanitizedPath[0]?.moduleId;
      if (firstModuleId === 'mqtt-in' && terminalStepType === 'mqtt-out') {
        throw new BadRequestException(
          `program.flows[${pathIndex}] cannot start with 'mqtt-in' and end with 'mqtt-out'` +
            ` — flow bridge loops are not allowed. Insert an intermediate Function node or change topology.`
        );
      }

      if (terminalStepType !== 'output' && terminalStepType !== 'mqtt-out') {
        throw new BadRequestException(
          `program.flows[${pathIndex}] must end with an output step or mqtt-out step`
        );
      }

      for (let index = 1; index < sanitizedPath.length - 1; index++) {
        if (sanitizedPath[index]?.stepType !== 'function') {
          throw new BadRequestException(
            `program.flows[${pathIndex}] can only contain function steps between input and output`
          );
        }
      }

      return sanitizedPath;
    });

    const warnings = Array.isArray(program.warnings)
      ? program.warnings.filter(
          (w): w is FlowNodeDiagnostic =>
            !!w &&
            typeof w === 'object' &&
            typeof w.nodeId === 'string' &&
            typeof w.message === 'string' &&
            (w.severity === 'warning' || w.severity === 'error')
        )
      : [];

    return {
      flows: sanitizedFlows,
      warnings,
    };
  }

  async create(data: LogicPayload): Promise<Logic> {
    const created = new this.logicModel({
      ...data,
      program: this.sanitizeProgram(data.program),
    });
    return created.save();
  }

  async findAll(query: PaginationQueryDto): Promise<{
    data: Logic[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const parsedPage = Number(query.page);
    const parsedLimit = Number(query.limit);

    const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 100)
        : 10;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.logicModel
        .find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.logicModel.countDocuments().exec(),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: total > 0 ? Math.ceil(total / limit) : 1,
    };
  }

  async findOne(id: string): Promise<Logic> {
    const logic = await this.logicModel.findById(id).exec();
    if (!logic) throw new NotFoundException(`Logic with ID ${id} not found`);
    return logic;
  }

  // Changed return type to allow null
  async findByFlowId(flowId: string): Promise<Logic | null> {
    return this.logicModel.findOne({ flowId }).exec();
  }

  async update(id: string, data: Partial<LogicPayload>): Promise<Logic> {
    const updateData: Partial<LogicPayload> = { ...data };
    if (updateData.program !== undefined) {
      updateData.program = this.sanitizeProgram(updateData.program);
    }

    const updated = await this.logicModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .exec();
    if (!updated) throw new NotFoundException(`Logic with ID ${id} not found`);
    return updated;
  }

  async upsertByFlowId(
    flowId: string,
    program: CommandExtraction
  ): Promise<Logic> {
    const sanitizedProgram = this.sanitizeProgram(program);
    const result = await this.logicModel
      .findOneAndUpdate(
        { flowId },
        { program: sanitizedProgram },
        { upsert: true, new: true }
      )
      .exec();

    return result as Logic;
  }

  async delete(id: string): Promise<void> {
    const result = await this.logicModel.findByIdAndDelete(id).exec();
    if (!result) throw new NotFoundException(`Logic with ID ${id} not found`);
  }

  async deleteByFlowId(flowId: string): Promise<void> {
    await this.logicModel.deleteOne({ flowId }).exec();
  }

  async setLogicPathSkipState(
    nodeId: string,
    flowId: string,
    skip: boolean
  ): Promise<void> {
    const logic = await this.logicModel.findOne({ flowId }).exec();
    if (!logic) {
      throw new NotFoundException(`Logic for flow ID ${flowId} not found`);
    }

    let pathFound = false;
    for (let i = 0; i < logic.program.flows.length; i++) {
      const outputNode =
        logic.program.flows[i][logic.program.flows[i].length - 1];
      if (
        outputNode &&
        outputNode.stepType === 'output' &&
        outputNode.id === nodeId
      ) {
        pathFound = true;
        logic.program.flows[i][0] = {
          ...logic.program.flows[i][0],
          skip,
        };
        break;
      }
    }

    if (!pathFound) {
      throw new NotFoundException(
        `Node ID ${nodeId} not found in logic for flow ID ${flowId}`
      );
    } else {
      logic.markModified('program');
      await logic.save();

      try {
        const deviceMac = (await this.devicesService.findByActiveFlowId(flowId))
          .macAddress;
        if (deviceMac) {
          this.evictForDevice(deviceMac);
        }
      } catch {
        //ignore errors from trying to find device by flowId
      }
    }
  }
}
