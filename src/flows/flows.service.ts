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
import { Ui } from './schemas/ui.schema';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';

export type FlowWithUiAndWarnings = Flow & {
  warnings: string[];
  ui: Ui | null;
};

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

  async create(flow: Flow, userId: string): Promise<FlowWithUiAndWarnings> {
    const createdFlow = new this.flowModel({
      ...flow,
      userId: userId,
    });

    const { nodes, edges } = flow;

    let setupData: SetupObject = { setup: [], tasks: [] };
    let logicData: CommandExtraction = { flows: [], warnings: [] };
    let uiData: UiItem[] = [];
    let ui: Ui | null = null;

    this.flowBuilderService.validateFlowStructure(nodes, edges);

    setupData = this.flowBuilderService.buildSetupFromNodes(nodes);

    logicData = this.flowBuilderService.buildLogicCommandsFromGraph(
      nodes,
      edges
    );
    uiData = this.flowBuilderService.buildUiFromNodes(nodes, edges);

    const savedFlow = await createdFlow.save();
    const savedFlowId = savedFlow.id as string;

    await this.setupService.create({
      flowId: savedFlowId,
      elements: setupData,
    });
    await this.logicService.create({
      flowId: savedFlowId,
      program: logicData,
    });
    ui = await this.uiService.create({
      flowId: savedFlowId,
      uiItems: uiData,
    });

    return {
      ...savedFlow.toObject(),
      warnings: logicData.warnings,
      ui: ui,
    };
  }

  async findAll(): Promise<Flow[]> {
    return this.flowModel.find().exec();
  }

  async findAllByUser(
    userId: string,
    query: PaginationQueryDto
  ): Promise<{
    data: Flow[];
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
    const filter: Record<string, unknown> = { userId: userId };

    if (query.search?.trim()) {
      const escaped = query.search
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escaped, 'i');
      filter.name = searchRegex;
    }

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.flowModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.flowModel.countDocuments(filter).exec(),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: total > 0 ? Math.ceil(total / limit) : 1,
    };
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

    return flow.toObject() as Flow;
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

  async update(
    id: string,
    userId: string,
    updatedFlow: Flow
  ): Promise<FlowWithUiAndWarnings> {
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
    let ui: Ui | null = null;
    let topicsData: TopicsData | undefined;

    if (updatedFlow.nodes && updatedFlow.edges) {
      this.flowBuilderService.validateFlowStructure(
        updatedFlow.nodes,
        updatedFlow.edges
      );

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
      ui = await this.uiService.upsertByFlowId(id, uiData, topicsData);
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
      ui: ui,
      warnings: logicData?.warnings || [],
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
