import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { isValidObjectId, Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Flow } from './schemas/flow.schema';
import { FlowBuilderService } from './flow-builder.service';
import { ModuleNode } from './types/flow.types';

@Injectable()
export class FlowsService {
  constructor(
    @InjectModel(Flow.name) private flowModel: Model<Flow>,
    private readonly flowBuilderService: FlowBuilderService,
  ) {}

  async create(flow: Flow, userId: string): Promise<Flow> {
    const { nodes, edges } = flow;
    const setup = this.flowBuilderService.buildSetupFromNodes(
      nodes as ModuleNode[],
    );
    const logic = this.flowBuilderService.buildLogicCommandsFromGraph(
      nodes as ModuleNode[],
      edges,
    );

    const createdFlow = new this.flowModel({
      ...flow,
      userId: userId,
      setup: setup,
      logic: logic,
    });
    return createdFlow.save();
  }

  async findAll(): Promise<Flow[]> {
    return this.flowModel.find().exec();
  }

  async findAllByUser(userId: string): Promise<Flow[]> {
    return this.flowModel.find({ userId: userId }).exec();
  }

  async findOne(id: string, userId: string): Promise<Flow> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid id format');
    }
    const flow = await this.flowModel
      .findOne({ _id: id, userId: userId })
      .exec();
    if (!flow) {
      throw new NotFoundException(`Flow with ID ${id} not found`);
    }
    return flow;
  }

  async update(id: string, userId: string, updatedFlow: Flow): Promise<Flow> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid id format');
    }

    const updatedFlowData = { ...updatedFlow };

    if (updatedFlow.nodes && updatedFlow.edges) {
      const { nodes, edges } = updatedFlow;
      const setup = this.flowBuilderService.buildSetupFromNodes(
        nodes as ModuleNode[],
      );
      const logic = this.flowBuilderService.buildLogicCommandsFromGraph(
        nodes as ModuleNode[],
        edges,
      );
      updatedFlowData.setup = setup;
      updatedFlowData.logic = logic;
    }

    const flow = await this.flowModel
      .findOneAndUpdate({ _id: id, userId: userId }, updatedFlowData, {
        new: true,
      })
      .exec();
    if (!flow) {
      throw new NotFoundException(`Flow with ID ${id} not found`);
    }
    return flow;
  }

  async delete(id: string, userId: string): Promise<Flow> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid id format');
    }
    const flow = await this.flowModel
      .findOneAndDelete({ _id: id, userId: userId })
      .exec();
    if (!flow) {
      throw new NotFoundException(`Flow with ID ${id} not found`);
    }
    return flow;
  }
}
