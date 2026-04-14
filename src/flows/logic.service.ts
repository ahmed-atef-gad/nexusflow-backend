import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Logic, LogicDocument } from './schemas/logic.schema';
import { LogicPayload } from './types/flow.types';
import { CommandExtraction, RuntimeStep } from './flow-builder.service';
import {
  DEFAULT_FUNCTION_NODE_MAX_AST_NODES,
  DEFAULT_FUNCTION_NODE_MAX_CODE_LENGTH,
  validateFunctionNodeCode,
} from './function-node-security.util';

const MAX_RUNTIME_FLOW_PATHS = 500;
const MAX_RUNTIME_STEPS_PER_PATH = 64;

@Injectable()
export class LogicService {
  private readonly functionNodeMaxCodeLength: number;
  private readonly functionNodeMaxAstNodes: number;

  constructor(
    @InjectModel(Logic.name) private logicModel: Model<LogicDocument>,
    private readonly configService: ConfigService
  ) {
    this.functionNodeMaxCodeLength = this.readPositiveConfigNumber(
      'FUNCTION_NODE_MAX_CODE_LENGTH',
      DEFAULT_FUNCTION_NODE_MAX_CODE_LENGTH
    );
    this.functionNodeMaxAstNodes = this.readPositiveConfigNumber(
      'FUNCTION_NODE_MAX_AST_NODES',
      DEFAULT_FUNCTION_NODE_MAX_AST_NODES
    );
  }

  private readPositiveConfigNumber(name: string, fallback: number): number {
    const raw = this.configService.get<string | number>(name);
    if (raw === undefined || raw === null || raw === '') return fallback;

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.trunc(parsed);
  }

  private ensureNonEmptyString(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${fieldName} must be a non-empty string`);
    }
    return value.trim();
  }

  private sanitizeFunctionCode(
    code: unknown,
    pathIndex: number,
    stepIndex: number
  ): string {
    const normalizedCode =
      typeof code === 'string' ? code.trim() : '';
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
    stepRaw: unknown,
    pathIndex: number,
    stepIndex: number
  ): RuntimeStep {
    if (!stepRaw || typeof stepRaw !== 'object') {
      throw new BadRequestException(
        `Runtime step at path ${pathIndex}, index ${stepIndex} is invalid`
      );
    }

    const step = stepRaw as RuntimeStep;
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
      step.stepType !== 'output'
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
        step.targetModuleType === 'other'
          ? step.targetModuleType
          : undefined,
    };

    return outputStep;
  }

  private sanitizeProgram(programRaw: unknown): CommandExtraction {
    if (!programRaw || typeof programRaw !== 'object') {
      throw new BadRequestException('program must be an object');
    }

    const program = programRaw as Partial<CommandExtraction>;
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
        this.sanitizeRuntimeStep(stepRaw, pathIndex, stepIndex)
      );

      if (sanitizedPath[0]?.stepType !== 'input') {
        throw new BadRequestException(
          `program.flows[${pathIndex}] must start with an input step`
        );
      }
      if (sanitizedPath[sanitizedPath.length - 1]?.stepType !== 'output') {
        throw new BadRequestException(
          `program.flows[${pathIndex}] must end with an output step`
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
          (warning): warning is string => typeof warning === 'string'
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

  async findAll(): Promise<Logic[]> {
    return this.logicModel.find().exec();
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
}
