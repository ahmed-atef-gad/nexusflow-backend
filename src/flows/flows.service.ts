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
  FlowNodeDiagnostic,
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
import { NotificationsService } from 'src/notifications/notifications.service';

export type FlowWithUiAndWarnings = Flow & {
  nodeDiagnostics?: FlowNodeDiagnostic[];
  ui: Ui | null;
};

export type FlowWithNotificationState = Flow & {
  isNotificationsEnabled: boolean;
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
    private readonly devicesService: DevicesService,
    private readonly notificationsService: NotificationsService
  ) {}

  private extractNodeRefs(
    nodes: Flow['nodes'] | undefined
  ): Array<{ nodeId: string; moduleId: string }> {
    if (!Array.isArray(nodes)) return [];
    return nodes
      .map((node) => ({
        nodeId: String(node.id ?? '').trim(),
        moduleId: String(node.data?.moduleId ?? '').trim(),
      }))
      .filter((node) => node.nodeId && node.moduleId);
  }

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

  private attachDiagnosticsToNodes(
    nodes: Flow['nodes'] | undefined,
    diagnostics: FlowNodeDiagnostic[]
  ): Flow['nodes'] {
    if (!Array.isArray(nodes) || !nodes.length) {
      return [];
    }

    const grouped = new Map<string, FlowNodeDiagnostic[]>();
    diagnostics.forEach((diagnostic) => {
      const existing = grouped.get(diagnostic.nodeId) ?? [];
      existing.push(diagnostic);
      grouped.set(diagnostic.nodeId, existing);
    });

    return nodes.map((node) => {
      const nodeDiagnostics = grouped.get(node.id) ?? [];
      const nodeWarnings = nodeDiagnostics.filter(
        (d) => d.severity === 'warning'
      );

      const currentData = (node.data ?? {}) as unknown as Record<
        string,
        unknown
      >;
      const nextData: Record<string, unknown> = {
        ...currentData,
      };

      if (nodeWarnings.length > 0) {
        nextData.warnings = nodeWarnings.map((warning) => ({
          severity: warning.severity,
          message: warning.message,
          code: warning.code,
        }));
      } else {
        delete nextData.warnings;
      }

      // Note: Errors are thrown immediately, not persisted to node data

      return {
        ...node,
        data: nextData as unknown as typeof node.data,
      };
    });
  }

  private resetNodeDiagnostics(
    nodes: Flow['nodes'] | undefined
  ): Flow['nodes'] {
    if (!Array.isArray(nodes) || !nodes.length) {
      return [];
    }

    return nodes.map((node) => {
      const currentData = (node.data ?? {}) as unknown as Record<
        string,
        unknown
      >;
      const nextData: Record<string, unknown> = {
        ...currentData,
      };

      delete nextData.warnings;

      return {
        ...node,
        data: nextData as unknown as typeof node.data,
      };
    });
  }

  private attachFunctionTopicsToNodes(
    nodes: Flow['nodes'] | undefined,
    deviceMac?: string | null
  ): Flow['nodes'] {
    if (!Array.isArray(nodes) || !nodes.length) {
      return [];
    }

    const normalizedMac = deviceMac?.trim().toUpperCase();

    return nodes.map((node) => {
      const currentData = (node.data ?? {}) as unknown as Record<
        string,
        unknown
      >;

      if (currentData.moduleId !== 'logic-function') {
        return {
          ...node,
          data: currentData as unknown as typeof node.data,
        };
      }

      const nextData: Record<string, unknown> = {
        ...currentData,
      };

      if (normalizedMac) {
        nextData.errorTopic = `/devices/${normalizedMac}/logic/error/${node.id}`;
        nextData.debugTopic = `/devices/${normalizedMac}/logic/debug/${node.id}`;
      } else {
        delete nextData.errorTopic;
        delete nextData.debugTopic;
      }

      return {
        ...node,
        data: nextData as unknown as typeof node.data,
      };
    });
  }

  async create(flow: Flow, userId: string): Promise<FlowWithUiAndWarnings> {
    const createdFlow = new this.flowModel({
      ...flow,
      userId: userId,
    });

    const { nodes, edges } = flow;
    const requestNodes = this.resetNodeDiagnostics(nodes);

    let setupData: SetupObject = { setup: [], tasks: [] };
    let logicData: CommandExtraction = { flows: [], warnings: [] };
    let uiData: UiItem[] = [];
    let ui: Ui | null = null;

    this.flowBuilderService.validateFlowStructure(requestNodes, edges);

    setupData = this.flowBuilderService.buildSetupFromNodes(requestNodes);

    logicData = this.flowBuilderService.buildLogicCommandsFromGraph(
      requestNodes,
      edges
    );
    const nodesWithDiagnostics = this.attachDiagnosticsToNodes(
      requestNodes,
      logicData.warnings
    );
    createdFlow.set('nodes', nodesWithDiagnostics);
    uiData = this.flowBuilderService.buildUiFromNodes(
      nodesWithDiagnostics,
      edges,
      undefined,
      createdFlow.id as string
    );

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
    await this.notificationsService.syncRulesForFlowNodes({
      flowId: savedFlowId,
      userId,
      nodes: this.extractNodeRefs(nodesWithDiagnostics),
    });

    return {
      ...savedFlow.toObject(),
      nodes: nodesWithDiagnostics,
      nodeDiagnostics: logicData.warnings,
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
    data: FlowWithNotificationState[];
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

    const flowIds = data.map((flowDoc) => String(flowDoc.id ?? ''));
    const [notificationStates, alertRulesMap] = await Promise.all([
      this.notificationsService.getNotificationStatesForFlows(userId, flowIds),
      this.getAlertRulesMapForFlows(userId, flowIds),
    ]);

    const enrichedData: FlowWithNotificationState[] = data.map((flowDoc) => {
      const flowObject = flowDoc.toObject() as Flow;
      const flowId = String(flowDoc.id ?? '');
      const hasAlertRules = alertRulesMap.get(flowId) ?? false;
      const preferenceEnabled = notificationStates.get(flowId);

      // Notifications can only be enabled if there are alert rules
      const isNotificationsEnabled =
        hasAlertRules && preferenceEnabled !== false;

      return {
        ...flowObject,
        isNotificationsEnabled,
      };
    });

    return {
      data: enrichedData,
      total,
      page,
      limit,
      totalPages: total > 0 ? Math.ceil(total / limit) : 1,
    };
  }

  private async getAlertRulesMapForFlows(
    userId: string,
    flowIds: string[]
  ): Promise<Map<string, boolean>> {
    const normalizedFlowIds = Array.from(
      new Set(flowIds.map((id) => id.trim()).filter((id) => id.length > 0))
    );

    if (!normalizedFlowIds.length) {
      return new Map<string, boolean>();
    }

    // Get count of alert rules per flow
    const result = await this.notificationsService.getAlertRulesCounts(
      userId,
      normalizedFlowIds
    );

    return result;
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

    let deviceMac: string | null = null;
    try {
      const device = await this.devicesService.findByActiveFlowId(id);
      deviceMac =
        typeof device?.macAddress === 'string' ? device.macAddress : null;
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
      deviceMac = null;
    }

    const flowObject = flow.toObject() as Flow;
    return {
      ...flowObject,
      nodes: this.attachFunctionTopicsToNodes(flowObject.nodes, deviceMac),
    } as Flow;
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
      deviceMac,
      flowId
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
      .findOne({ _id: id, userId: userId })
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
      const requestNodes = this.resetNodeDiagnostics(updatedFlow.nodes);

      this.flowBuilderService.validateFlowStructure(
        requestNodes,
        updatedFlow.edges
      );

      setupData = this.flowBuilderService.buildSetupFromNodes(requestNodes);
      logicData = this.flowBuilderService.buildLogicCommandsFromGraph(
        requestNodes,
        updatedFlow.edges
      );

      const nodesWithDiagnostics = this.attachDiagnosticsToNodes(
        requestNodes,
        logicData.warnings
      );

      uiData = this.flowBuilderService.buildUiFromNodes(
        nodesWithDiagnostics,
        updatedFlow.edges,
        device?.macAddress,
        id
      );

      topicsData = this.flowBuilderService.buildTopicsForUi(device?.macAddress);

      // Persist setup object for this flow
      await this.setupService.upsertByFlowId(id, setupData);
      ui = await this.uiService.upsertByFlowId(id, uiData, topicsData);
      await this.logicService.upsertByFlowId(id, logicData);
      await this.notificationsService.syncRulesForFlowNodes({
        flowId: id,
        userId,
        nodes: this.extractNodeRefs(nodesWithDiagnostics),
      });

      flow.set({
        ...updatedFlow,
        nodes: nodesWithDiagnostics,
      });
      await flow.save();

      // this.mqttService.publish(`esp/setup`, setupData);
    } else {
      flow.set(updatedFlow);
      await flow.save();

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
      nodeDiagnostics: logicData?.warnings || [],
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
    await this.notificationsService.cleanupFlowNotificationData(id);
  }
}
