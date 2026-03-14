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
import {
  CommandExtraction,
  FlowBuilderService,
  SetupObject,
  TopicsData,
} from './flow-builder.service';
import { SetupService } from './setup.service';
import { LogicService } from './logic.service';
import { MqttService } from 'src/mqtt/mqtt.service';
import { DevicesService } from 'src/devices/devices.service';
import { UiService } from './ui.service';
import { UiItem } from './schemas/uiItem.schema';

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
  ) {}

  private toCommandExtraction(value: unknown): CommandExtraction {
    if (
      typeof value === 'object' &&
      value !== null &&
      'flows' in value &&
      'warnings' in value
    ) {
      return value as CommandExtraction;
    }

    return { flows: [], warnings: [] };
  }

  async create(flow: Flow, userId: string): Promise<any> {
    const createdFlow = new this.flowModel({
      ...flow,
      userId: userId,
    });

    const { nodes, edges } = flow;

    let setupData: SetupObject = { setup: [], tasks: [] };
    let logicData: CommandExtraction = { flows: [], warnings: [] };
    let uiData: UiItem[] = [];
    let savedFlow: FlowDocument;

    if (nodes && edges) {
      setupData = this.flowBuilderService.buildSetupFromNodes(nodes);

      logicData = this.flowBuilderService.buildLogicCommandsFromGraph(
        nodes,
        edges
      );
      uiData = this.flowBuilderService.buildUiFromNodes(nodes, edges);
      savedFlow = await createdFlow.save();
      const savedFlowId = savedFlow.id as string;

      await this.setupService.create({
        flowId: savedFlowId,
        elements: setupData,
      });
      await this.logicService.create({
        flowId: savedFlowId,
        program: logicData,
      });
      await this.uiService.create({
        flowId: savedFlowId,
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
      setup: setupDoc ? setupDoc.elements : { setup: [], tasks: [] },
      logic: logicDoc
        ? this.toCommandExtraction(logicDoc.program as unknown)
        : this.toCommandExtraction(undefined),
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
      id: flow.id as string,
      userId: flow.userId,
    };
  }

  async rebuildUiForFlow(flowId: string, deviceMac?: string): Promise<any> {
    if (!isValidObjectId(flowId)) {
      throw new BadRequestException('Invalid id format');
    }

    const flow = await this.flowModel.findById(flowId).exec();
    if (!flow) {
      throw new NotFoundException(`Flow with ID ${flowId} not found`);
    }

    const uiData = this.flowBuilderService.buildUiFromNodes(
      flow.nodes ?? [],
      flow.edges ?? [],
      deviceMac
    );
    await this.uiService.upsertByFlowId(flowId, uiData);
    return uiData;
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

    let device: { macAddress: string } | null = null;
    try {
      device = await this.devicesService.findByActiveFlowId(id);
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
      device = null;
    }

    let setupData: SetupObject | undefined = { setup: [], tasks: [] };
    let logicData: CommandExtraction | undefined;
    let uiData: UiItem[] | undefined;
    let topicsData: TopicsData | undefined;

    if (updatedFlow.nodes && updatedFlow.edges) {
      setupData = this.flowBuilderService.buildSetupFromNodes(
        updatedFlow.nodes
      );
      logicData = this.flowBuilderService.buildLogicCommandsFromGraph(
        updatedFlow.nodes,
        updatedFlow.edges
      );
      uiData = this.flowBuilderService.buildUiFromNodes(
        updatedFlow.nodes,
        updatedFlow.edges,
        device?.macAddress
      );

      topicsData = this.flowBuilderService.buildTopicsForUi(device?.macAddress);

      // Persist setup object for this flow
      await this.setupService.upsertByFlowId(id, setupData);
      await this.uiService.upsertByFlowId(id, uiData, topicsData);
      await this.logicService.upsertByFlowId(id, logicData);

      // this.mqttService.publish(`esp/setup`, setupData);
    } else {
      const s = await this.setupService.findByFlowId(id);
      const l = await this.logicService.findByFlowId(id);
      setupData = s?.elements;
      logicData = l
        ? this.toCommandExtraction(l.program as unknown)
        : undefined;
      const u = await this.uiService.findByFlowId(id);
      uiData = u?.uiItems;
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
      topics: topicsData,
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
