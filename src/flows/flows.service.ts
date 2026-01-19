import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { isValidObjectId, Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Flow, FlowDocument } from './schemas/flow.schema';
import { FlowBuilderService } from './flow-builder.service';
import { ModuleNode } from './types/flow.types';
import { SetupService } from './setup.service';
import { LogicService } from './logic.service';

@Injectable()
export class FlowsService {
  constructor(
    @InjectModel(Flow.name) private flowModel: Model<FlowDocument>,
    private readonly flowBuilderService: FlowBuilderService,
    private readonly setupService: SetupService,
    private readonly logicService: LogicService
  ) {}

  async create(flow: Flow, userId: string): Promise<any> {
    const createdFlow = new this.flowModel({
      ...flow,
      userId: userId,
    });

    const { nodes, edges } = flow;

    let setupData: any[] = [];
    let logicData: any = {};
    let savedFlow: FlowDocument;

    if (nodes && edges) {
      setupData = this.flowBuilderService.buildSetupFromNodes(
        nodes as ModuleNode[]
      );
      logicData = this.flowBuilderService.buildLogicCommandsFromGraph(
        nodes as ModuleNode[],
        edges
      );
      savedFlow = await createdFlow.save();

      await this.setupService.create({
        flowId: savedFlow.id,
        elements: setupData,
      });
      await this.logicService.create({
        flowId: savedFlow.id,
        program: logicData,
      });
    } else {
      throw new BadRequestException(
        'Nodes and edges are required to create a flow'
      );
    }

    return {
      ...savedFlow.toObject(),
      setup: setupData,
      logic: logicData,
    };
  }

  async findAll(): Promise<Flow[]> {
    return this.flowModel.find().exec();
  }

  async findAllByUser(userId: string): Promise<Flow[]> {
    return this.flowModel.find({ userId: userId }).exec();
  }

  async findOne(id: string, userId: string): Promise<any> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid id format');
    }
    const flow = await this.flowModel
      .findOne({ _id: id, userId: userId })
      .exec();
    if (!flow) {
      throw new NotFoundException(`Flow with ID ${id} not found`);
    }

    const setupDoc = await this.setupService.findByFlowId(id);
    const logicDoc = await this.logicService.findByFlowId(id);

    return {
      ...flow.toObject(),
      setup: setupDoc ? setupDoc.elements : [],
      logic: logicDoc ? logicDoc.program : {},
    };
  }

  async update(id: string, userId: string, updatedFlow: Flow): Promise<any> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid id format');
    }

    const flow = await this.flowModel
      .findOneAndUpdate({ _id: id, userId: userId }, updatedFlow, {
        new: true,
      })
      .exec();

    if (!flow) {
      throw new NotFoundException(`Flow with ID ${id} not found`);
    }

    // Explicitly type these variables so TypeScript knows they aren't just "null"
    let setupData: any[] | undefined;
    let logicData: any | undefined;

    if (updatedFlow.nodes && updatedFlow.edges) {
      setupData = this.flowBuilderService.buildSetupFromNodes(
        updatedFlow.nodes as ModuleNode[]
      );
      logicData = this.flowBuilderService.buildLogicCommandsFromGraph(
        updatedFlow.nodes as ModuleNode[],
        updatedFlow.edges
      );

      // We know setupData is an array here, so it's safe to pass
      await this.setupService.upsertByFlowId(id, setupData);
      await this.logicService.upsertByFlowId(id, logicData);
    } else {
      const s = await this.setupService.findByFlowId(id);
      const l = await this.logicService.findByFlowId(id);
      setupData = s?.elements;
      logicData = l?.program;
    }

    return {
      ...flow.toObject(),
      setup: setupData,
      logic: logicData,
    };
  }

  async delete(id: string, userId: string): Promise<void> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid id format');
    }

    const flow = await this.flowModel
      .findOneAndDelete({ _id: id, userId: userId })
      .exec();

    if (!flow) {
      throw new NotFoundException(`Flow with ID ${id} not found`);
    }

    await this.setupService.deleteByFlowId(id);
    await this.logicService.deleteByFlowId(id);
  }
}
