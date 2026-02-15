import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { isValidObjectId, Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Flow, FlowDocument } from './schemas/flow.schema';
import { FlowBuilderService } from './flow-builder.service';
import { ModuleNode } from './types/flow.types';
import { SetupService } from './setup.service';
import { LogicService } from './logic.service';
import { MqttService } from 'src/mqtt/mqtt.service';
import { DevicesService } from 'src/devices/devices.service';
import { UiService } from './ui.service';

@Injectable()
export class FlowsService {
  constructor(
    @InjectModel(Flow.name) private flowModel: Model<FlowDocument>,
    private readonly flowBuilderService: FlowBuilderService,
    private readonly setupService: SetupService,
    private readonly uiService: UiService,
    private readonly logicService: LogicService,
    private readonly mqttService: MqttService,
    @Inject(forwardRef(() => DevicesService))
    private readonly devicesService: DevicesService


  ) { }

  async create(flow: Flow, userId: string): Promise<any> {
    const createdFlow = new this.flowModel({
      ...flow,
      userId: userId,
    });

    const { nodes, edges } = flow;

    let setupData: any = {};
    let logicData: any = {};
    let uiData: any = {};
    let savedFlow: FlowDocument;

    if (nodes && edges) {
      const setupResult = this.flowBuilderService.buildSetupFromNodes(nodes);
      setupData = setupResult;
      logicData = this.flowBuilderService.buildLogicCommandsFromGraph(
        nodes,
        edges
      );
      uiData = this.flowBuilderService.buildUiFromNodes(nodes);
      savedFlow = await createdFlow.save();

      await this.setupService.create({
        flowId: savedFlow.id,
        elements: setupData,
      });
      await this.logicService.create({
        flowId: savedFlow.id,
        program: logicData,
      });
      await this.uiService.create({
        flowId: savedFlow.id,
        elements: uiData,
      });
    } else {
      throw new BadRequestException(
        'Nodes and edges are required to create a flow'
      );
    }
    // this.mqttService.publish(`esp/setup`, setupData);

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

  async findFlowById(id: string): Promise<any> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid id format');
    }

    const flow = await this.flowModel.findById(id).exec();
    if (!flow) {
      throw new NotFoundException(`Flow with ID ${id} not found`);
    }

    return {
      id: flow.id,
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
    let setupData: any | undefined;
    let logicData: any | undefined;
    let uiData: any | undefined;

    if (updatedFlow.nodes && updatedFlow.edges) {
      const setupResult = this.flowBuilderService.buildSetupFromNodes(
        updatedFlow.nodes
      );
      setupData = setupResult;
      logicData = this.flowBuilderService.buildLogicCommandsFromGraph(
        updatedFlow.nodes,
        updatedFlow.edges
      );
      uiData = this.flowBuilderService.buildUiFromNodes(updatedFlow.nodes);

      // Extract the setup array and pass it to upsertByFlowId
      await this.setupService.upsertByFlowId(id, setupData);
      await this.uiService.upsertByFlowId(id, uiData);
      await this.logicService.upsertByFlowId(id, logicData);

      // this.mqttService.publish(`esp/setup`, setupData);


    } else {
      const s = await this.setupService.findByFlowId(id);
      const l = await this.logicService.findByFlowId(id);
      setupData = s?.elements;
      logicData = l?.program;
      const u = await this.uiService.findByFlowId(id);
      uiData = u?.uiItems;
    }
    let device;
    try {
      device = await this.devicesService.findByActiveFlowId(id);
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
      device = null;
    }
    if (device) {
      await this.mqttService.publishFlowLastUpdateChanged(
        device.macAddress,
        id,
        flow.updatedAt ?? new Date()
      );
    }


    return {
      ...flow.toObject(),
      setup: setupData,
      logic: logicData,
      ui: uiData,
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
