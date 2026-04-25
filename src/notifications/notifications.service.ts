import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { App, cert, getApps, initializeApp } from 'firebase-admin/app';
import {
  BatchResponse,
  getMessaging,
  Messaging,
  MulticastMessage,
} from 'firebase-admin/messaging';
import { RegisterNotificationDeviceDto } from './dto/register-notification-device.dto';
import { TriggerAlertDto } from './dto/trigger-alert.dto';
import { AlertEvent, AlertEventDocument } from './schemas/alert-event.schema';
import { AlertHistoryQueryDto } from './dto/alert-history-query.dto';
import {
  AlertPolicy,
  AlertPolicyDocument,
} from './schemas/alert-policy.schema';
import {
  AlertRule,
  AlertRuleDocument,
} from './schemas/alert-rule.schema';
import { Flow, FlowDocument } from 'src/flows/schemas/flow.schema';
import {
  NotificationPreference,
  NotificationPreferenceDocument,
} from './schemas/notification-preference.schema';
import { UpsertAlertPoliciesDto } from './dto/upsert-alert-policies.dto';
import { CreateAlertRuleDto } from './dto/create-alert-rule.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { UpdateAlertRuleDto } from './dto/update-alert-rule.dto';
import {
  NotificationDeviceToken,
  NotificationDeviceTokenDocument,
} from './schemas/notification-device-token.schema';

type AlertSeverity = 'critical' | 'warning' | 'info';

type SendProjectAlertInput = {
  projectId: string;
  title: string;
  body: string;
  data?: Record<string, string | number | boolean>;
  severity?: AlertSeverity;
};

type ProcessSensorReadingInput = {
  projectId: string;
  sensorType: string;
  value: number;
  occurredAt?: Date;
  metadata?: Record<string, string | number | boolean>;
};

type AlertRuleActionPayload = {
  title?: string;
  body?: string;
};

type TriggerAlertResult = {
  event: {
    id: string;
    projectId: string;
    sensorType: string;
    severity: AlertSeverity;
    title: string;
    body: string;
    value?: number;
    threshold?: number;
    ruleId?: string;
    occurredAt: Date;
    createdAt?: Date;
  };
  delivery: {
    requestedTokens: number;
    successCount: number;
    failureCount: number;
    invalidatedTokens: number;
    error?: string;
  };
};

type AlertHistoryCursor = {
  occurredAt: string;
  id: string;
};

type AlertHistoryItem = {
  id: string;
  projectId: string;
  sensorType: string;
  severity: AlertSeverity;
  title: string;
  body: string;
  value?: number;
  threshold?: number;
  ruleId?: string;
  occurredAt: Date;
  createdAt?: Date;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private firebaseApp?: App;
  private messagingClient?: Messaging;
  private readonly deadTokenErrorCodes = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'UNREGISTERED',
  ]);
  private readonly ruleCooldownMs: number;
  private readonly recentRuleTriggers = new Map<string, number>();

  constructor(
    @InjectModel(NotificationDeviceToken.name)
    private readonly notificationDeviceTokenModel: Model<NotificationDeviceTokenDocument>,
    @InjectModel(AlertEvent.name)
    private readonly alertEventModel: Model<AlertEventDocument>,
    @InjectModel(NotificationPreference.name)
    private readonly notificationPreferenceModel: Model<NotificationPreferenceDocument>,
    @InjectModel(AlertPolicy.name)
    private readonly alertPolicyModel: Model<AlertPolicyDocument>,
    @InjectModel(AlertRule.name)
    private readonly alertRuleModel: Model<AlertRuleDocument>,
    @InjectModel(Flow.name)
    private readonly flowModel: Model<FlowDocument>,
    private readonly configService: ConfigService,
  ) {
    this.ruleCooldownMs = this.readPositiveConfigNumber(
      'ALERT_RULE_COOLDOWN_MS',
      60000,
    );
  }

  async registerDeviceToken(
    userId: string,
    dto: RegisterNotificationDeviceDto,
  ): Promise<{
    id: string;
    userId: string;
    deviceId: string;
    platform: 'android' | 'ios';
    isActive: boolean;
    lastSeenAt: Date;
    updatedAt?: Date;
    createdAt?: Date;
  }> {
    // FCM token must belong to a single active registration.
    await this.notificationDeviceTokenModel.deleteMany({
      fcmToken: dto.fcmToken,
      $or: [{ userId: { $ne: userId } }, { deviceId: { $ne: dto.deviceId } }],
    });

    const now = new Date();
    const document = await this.notificationDeviceTokenModel.findOneAndUpdate(
      { userId, deviceId: dto.deviceId },
      {
        $set: {
          platform: dto.platform,
          fcmToken: dto.fcmToken,
          appVersion: dto.appVersion,
          locale: dto.locale,
          isActive: true,
          lastError: null,
          invalidatedAt: null,
          lastSeenAt: now,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );

    return {
      id: document.id,
      userId: document.userId,
      deviceId: document.deviceId,
      platform: document.platform,
      isActive: document.isActive,
      lastSeenAt: document.lastSeenAt,
      updatedAt: document.updatedAt,
      createdAt: document.createdAt,
    };
  }

  async triggerAlert(input: TriggerAlertDto): Promise<TriggerAlertResult> {
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    const title = input.title?.trim() || this.buildDefaultAlertTitle(input);
    const body = input.body?.trim() || this.buildDefaultAlertBody(input);

    const createdEvent = await this.alertEventModel.create({
      projectId: input.projectId,
      sensorType: input.sensorType,
      severity: input.severity,
      title,
      body,
      value: input.value,
      threshold: input.threshold,
      ruleId: input.ruleId,
      occurredAt,
    });

    let delivery: TriggerAlertResult['delivery'];
    try {
      delivery = await this.sendAlertToProject({
        projectId: input.projectId,
        title,
        body,
        severity: input.severity,
        data: {
          ...input.data,
          type: 'ALERT_TRIGGERED',
          sensorType: input.sensorType,
          ruleId: input.ruleId ?? '',
          value: input.value ?? '',
          threshold: input.threshold ?? '',
          timestamp: occurredAt.toISOString(),
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown push delivery error';
      this.logger.error(
        `Alert event ${createdEvent.id} saved but push delivery failed: ${message}`,
      );

      delivery = {
        requestedTokens: 0,
        successCount: 0,
        failureCount: 0,
        invalidatedTokens: 0,
        error: message,
      };
    }

    return {
      event: {
        id: createdEvent.id,
        projectId: createdEvent.projectId,
        sensorType: createdEvent.sensorType,
        severity: createdEvent.severity,
        title: createdEvent.title,
        body: createdEvent.body,
        value: createdEvent.value,
        threshold: createdEvent.threshold,
        ruleId: createdEvent.ruleId,
        occurredAt: createdEvent.occurredAt,
        createdAt: createdEvent.createdAt,
      },
      delivery,
    };
  }

  async getAlertHistory(
    userId: string,
    projectId: string,
    query: AlertHistoryQueryDto,
  ): Promise<{ items: AlertHistoryItem[]; nextCursor: string | null }> {
    await this.assertUserCanAccessProject(userId, projectId);

    const parsedLimit = Number(query.limit);
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 100)
        : 50;

    const cursor = this.decodeHistoryCursor(query.cursor);
    const filter = this.buildHistoryFilter(projectId, cursor);

    const events = await this.alertEventModel
      .find(filter)
      .sort({ occurredAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean()
      .exec();

    const hasMore = events.length > limit;
    const selected = hasMore ? events.slice(0, limit) : events;

    const items = selected.map((event) => ({
      id: String(event._id),
      projectId: event.projectId,
      sensorType: event.sensorType,
      severity: event.severity,
      title: event.title,
      body: event.body,
      value: event.value,
      threshold: event.threshold,
      ruleId: event.ruleId,
      occurredAt: event.occurredAt,
      createdAt: event.createdAt,
    }));

    const nextCursor =
      hasMore && selected.length
        ? this.encodeHistoryCursor({
            occurredAt: selected[selected.length - 1].occurredAt.toISOString(),
            id: String(selected[selected.length - 1]._id),
          })
        : null;

    return {
      items,
      nextCursor,
    };
  }

  async getNotificationPreferences(userId: string, projectId: string): Promise<{
    items: Array<{
      sensorType: string;
      enabled: boolean;
      threshold?: number;
      required: boolean;
      thresholdRequired: boolean;
      defaultEnabled: boolean;
      defaultSeverity: AlertSeverity;
    }>;
  }> {
    await this.assertUserCanAccessProject(userId, projectId);

    const [policies, existingPreferences] = await Promise.all([
      this.alertPolicyModel
        .find({ projectId, isActive: true })
        .sort({ sensorType: 1 })
        .lean()
        .exec(),
      this.notificationPreferenceModel.findOne({ projectId, userId }).lean().exec(),
    ]);

    const preferenceMap = new Map<
      string,
      { enabled: boolean; threshold?: number }
    >();
    for (const preference of existingPreferences?.sensors ?? []) {
      const sensorType = this.normalizeSensorType(preference.sensorType);
      if (!sensorType) {
        continue;
      }
      preferenceMap.set(sensorType, {
        enabled: preference.enabled,
        threshold: preference.threshold,
      });
    }

    return {
      items: policies.map((policy) => {
        const sensorType = this.normalizeSensorType(policy.sensorType);
        const preference = preferenceMap.get(sensorType);
        const enabled = policy.required
          ? true
          : preference?.enabled ?? policy.defaultEnabled;

        return {
          sensorType,
          enabled,
          threshold: preference?.threshold,
          required: policy.required,
          thresholdRequired: policy.thresholdRequired,
          defaultEnabled: policy.defaultEnabled,
          defaultSeverity: policy.defaultSeverity,
        };
      }),
    };
  }

  async updateNotificationPreferences(
    userId: string,
    projectId: string,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<{
    items: Array<{
      sensorType: string;
      enabled: boolean;
      threshold?: number;
      required: boolean;
      thresholdRequired: boolean;
      defaultEnabled: boolean;
      defaultSeverity: AlertSeverity;
    }>;
  }> {
    await this.assertUserCanAccessProject(userId, projectId);

    const [policies, existingPreferences] = await Promise.all([
      this.alertPolicyModel
        .find({ projectId, isActive: true })
        .sort({ sensorType: 1 })
        .lean()
        .exec(),
      this.notificationPreferenceModel.findOne({ projectId, userId }).lean().exec(),
    ]);

    if (!policies.length) {
      throw new BadRequestException(
        'No alert policies configured for this project.',
      );
    }

    const policyMap = new Map(
      policies.map((policy) => [this.normalizeSensorType(policy.sensorType), policy]),
    );
    const existingPreferenceMap = new Map<
      string,
      { enabled: boolean; threshold?: number }
    >();
    for (const preference of existingPreferences?.sensors ?? []) {
      const sensorType = this.normalizeSensorType(preference.sensorType);
      if (!sensorType) {
        continue;
      }
      existingPreferenceMap.set(sensorType, {
        enabled: preference.enabled,
        threshold: preference.threshold,
      });
    }

    const normalizedInput = new Map<
      string,
      { enabled: boolean; threshold?: number }
    >();
    for (const sensorPreference of dto.sensors ?? []) {
      const sensorType = this.normalizeSensorType(sensorPreference.sensorType);
      if (!sensorType) {
        continue;
      }

      const policy = policyMap.get(sensorType);
      if (!policy) {
        throw new BadRequestException(
          `Unknown sensorType "${sensorPreference.sensorType}" for this project.`,
        );
      }

      if (
        policy.thresholdRequired &&
        sensorPreference.threshold === undefined &&
        existingPreferenceMap.get(sensorType)?.threshold === undefined
      ) {
        throw new BadRequestException(
          `threshold is required for sensorType "${sensorType}".`,
        );
      }

      normalizedInput.set(sensorType, {
        enabled: policy.required ? true : sensorPreference.enabled,
        threshold:
          sensorPreference.threshold !== undefined
            ? sensorPreference.threshold
            : existingPreferenceMap.get(sensorType)?.threshold,
      });
    }

    for (const policy of policies) {
      const sensorType = this.normalizeSensorType(policy.sensorType);
      if (normalizedInput.has(sensorType)) {
        continue;
      }

      if (policy.required) {
        normalizedInput.set(sensorType, {
          enabled: true,
          threshold: existingPreferenceMap.get(sensorType)?.threshold,
        });
      }
    }

    const mergedSensors = Array.from(normalizedInput.entries())
      .map(([sensorType, value]) => ({
        sensorType,
        enabled: value.enabled,
        threshold: value.threshold,
      }))
      .sort((left, right) => left.sensorType.localeCompare(right.sensorType));

    await this.notificationPreferenceModel.findOneAndUpdate(
      { projectId, userId },
      { $set: { sensors: mergedSensors } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return this.getNotificationPreferences(userId, projectId);
  }

  async getAlertPolicies(userId: string, projectId: string): Promise<{
    items: Array<{
      id: string;
      projectId: string;
      sensorType: string;
      required: boolean;
      thresholdRequired: boolean;
      defaultEnabled: boolean;
      defaultSeverity: AlertSeverity;
      isActive: boolean;
    }>;
  }> {
    await this.assertUserCanAccessProject(userId, projectId);

    const policies = await this.alertPolicyModel
      .find({ projectId, isActive: true })
      .sort({ sensorType: 1 })
      .lean()
      .exec();

    return {
      items: policies.map((policy) => ({
        id: String(policy._id),
        projectId: policy.projectId,
        sensorType: policy.sensorType,
        required: policy.required,
        thresholdRequired: policy.thresholdRequired,
        defaultEnabled: policy.defaultEnabled,
        defaultSeverity: policy.defaultSeverity,
        isActive: policy.isActive,
      })),
    };
  }

  async upsertAlertPolicies(
    userId: string,
    projectId: string,
    dto: UpsertAlertPoliciesDto,
  ): Promise<{ updatedCount: number; items: Array<{ id: string; sensorType: string }> }> {
    await this.assertUserCanAccessProject(userId, projectId);

    const normalizedPolicies = this.deduplicatePolicies(dto.policies ?? []);
    if (!normalizedPolicies.length) {
      return { updatedCount: 0, items: [] };
    }

    const operations = normalizedPolicies.map((policy) => ({
      updateOne: {
        filter: { projectId, sensorType: policy.sensorType },
        update: {
          $set: {
            required: policy.required,
            thresholdRequired: policy.thresholdRequired,
            defaultEnabled: policy.defaultEnabled,
            defaultSeverity: policy.defaultSeverity,
            isActive: true,
          },
        },
        upsert: true,
      },
    }));

    await this.alertPolicyModel.bulkWrite(operations, { ordered: false });

    const items = await this.alertPolicyModel
      .find({
        projectId,
        sensorType: { $in: normalizedPolicies.map((entry) => entry.sensorType) },
      })
      .select({ sensorType: 1 })
      .lean()
      .exec();

    return {
      updatedCount: items.length,
      items: items.map((item) => ({
        id: String(item._id),
        sensorType: item.sensorType,
      })),
    };
  }

  async getAlertRules(userId: string, projectId: string): Promise<{
    items: Array<{
      id: string;
      projectId: string;
      userId: string;
      sensorType: string;
      operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
      threshold: number;
      enabled: boolean;
      severity: AlertSeverity;
      actions: unknown[];
      createdAt?: Date;
      updatedAt?: Date;
    }>;
  }> {
    await this.assertUserCanAccessProject(userId, projectId);

    const rules = await this.alertRuleModel
      .find({ projectId, userId })
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean()
      .exec();

    return {
      items: rules.map((rule) => ({
        id: String(rule._id),
        projectId: rule.projectId,
        userId: rule.userId,
        sensorType: rule.sensorType,
        operator: rule.operator,
        threshold: rule.threshold,
        enabled: rule.enabled,
        severity: rule.severity,
        actions: Array.isArray(rule.actions) ? rule.actions : [],
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt,
      })),
    };
  }

  async createAlertRule(
    userId: string,
    projectId: string,
    dto: CreateAlertRuleDto,
  ): Promise<{
    id: string;
    projectId: string;
    userId: string;
    sensorType: string;
    operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
    threshold: number;
    enabled: boolean;
    severity: AlertSeverity;
    actions: unknown[];
    createdAt?: Date;
    updatedAt?: Date;
  }> {
    await this.assertUserCanAccessProject(userId, projectId);

    const createdRule = await this.alertRuleModel.create({
      projectId,
      userId,
      sensorType: dto.sensorType.trim(),
      operator: dto.operator,
      threshold: dto.threshold,
      enabled: dto.enabled ?? true,
      severity: dto.severity,
      actions: this.normalizeRuleActions(dto.actions),
    });

    return {
      id: createdRule.id,
      projectId: createdRule.projectId,
      userId: createdRule.userId,
      sensorType: createdRule.sensorType,
      operator: createdRule.operator,
      threshold: createdRule.threshold,
      enabled: createdRule.enabled,
      severity: createdRule.severity,
      actions: Array.isArray(createdRule.actions) ? createdRule.actions : [],
      createdAt: createdRule.createdAt,
      updatedAt: createdRule.updatedAt,
    };
  }

  async updateAlertRule(
    userId: string,
    projectId: string,
    ruleId: string,
    dto: UpdateAlertRuleDto,
  ): Promise<{
    id: string;
    projectId: string;
    userId: string;
    sensorType: string;
    operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
    threshold: number;
    enabled: boolean;
    severity: AlertSeverity;
    actions: unknown[];
    createdAt?: Date;
    updatedAt?: Date;
  }> {
    await this.assertUserCanAccessProject(userId, projectId);

    const updatePayload: Record<string, unknown> = {};
    if (dto.sensorType !== undefined) {
      updatePayload.sensorType = dto.sensorType.trim();
    }
    if (dto.operator !== undefined) {
      updatePayload.operator = dto.operator;
    }
    if (dto.threshold !== undefined) {
      updatePayload.threshold = dto.threshold;
    }
    if (dto.severity !== undefined) {
      updatePayload.severity = dto.severity;
    }
    if (dto.enabled !== undefined) {
      updatePayload.enabled = dto.enabled;
    }
    if (dto.actions !== undefined) {
      updatePayload.actions = this.normalizeRuleActions(dto.actions);
    }

    const updatedRule = await this.alertRuleModel
      .findOneAndUpdate(
        { _id: ruleId, projectId, userId },
        { $set: updatePayload },
        { new: true },
      )
      .exec();

    if (!updatedRule) {
      throw new NotFoundException('Alert rule not found');
    }

    return {
      id: updatedRule.id,
      projectId: updatedRule.projectId,
      userId: updatedRule.userId,
      sensorType: updatedRule.sensorType,
      operator: updatedRule.operator,
      threshold: updatedRule.threshold,
      enabled: updatedRule.enabled,
      severity: updatedRule.severity,
      actions: Array.isArray(updatedRule.actions) ? updatedRule.actions : [],
      createdAt: updatedRule.createdAt,
      updatedAt: updatedRule.updatedAt,
    };
  }

  async deleteAlertRule(
    userId: string,
    projectId: string,
    ruleId: string,
  ): Promise<{ acknowledged: boolean; deletedRuleId: string }> {
    await this.assertUserCanAccessProject(userId, projectId);

    const result = await this.alertRuleModel
      .findOneAndDelete({ _id: ruleId, projectId, userId })
      .exec();

    if (!result) {
      throw new NotFoundException('Alert rule not found');
    }

    return {
      acknowledged: true,
      deletedRuleId: ruleId,
    };
  }

  async processSensorReading(input: ProcessSensorReadingInput): Promise<{
    evaluatedRules: number;
    triggeredRules: number;
  }> {
    const normalizedSensorType = this.normalizeSensorType(input.sensorType);
    if (!normalizedSensorType || !Number.isFinite(input.value)) {
      return { evaluatedRules: 0, triggeredRules: 0 };
    }

    const rules = await this.alertRuleModel
      .find({ projectId: input.projectId, enabled: true })
      .lean()
      .exec();

    let evaluatedRules = 0;
    let triggeredRules = 0;
    const occurredAt = input.occurredAt ?? new Date();

    for (const rule of rules) {
      if (
        this.normalizeSensorType(rule.sensorType) !== normalizedSensorType ||
        typeof rule.threshold !== 'number' ||
        !Number.isFinite(rule.threshold)
      ) {
        continue;
      }

      evaluatedRules++;
      if (!this.matchesOperator(input.value, rule.operator, rule.threshold)) {
        continue;
      }

      const cooldownKey = `${input.projectId}:${String(rule._id)}`;
      if (!this.shouldTriggerRule(cooldownKey)) {
        continue;
      }

      const pushAction = this.extractPushAction(rule.actions);
      const pushPayload = this.extractPushPayload(pushAction?.payload);

      await this.triggerAlert({
        projectId: input.projectId,
        sensorType: rule.sensorType,
        severity: rule.severity,
        title: pushPayload.title,
        body: pushPayload.body,
        value: input.value,
        threshold: rule.threshold,
        ruleId: String(rule._id),
        occurredAt: occurredAt.toISOString(),
        data: {
          ...input.metadata,
          source: 'mqtt',
        },
      });
      triggeredRules++;
    }

    return { evaluatedRules, triggeredRules };
  }

  async sendAlertToProject(input: SendProjectAlertInput): Promise<{
    requestedTokens: number;
    successCount: number;
    failureCount: number;
    invalidatedTokens: number;
  }> {
    const recipientUserIds = await this.getProjectRecipientUserIds(input.projectId);
    if (!recipientUserIds.length) {
      this.logger.warn(
        `Skipping push dispatch for project ${input.projectId}: no project recipients found.`,
      );
      return {
        requestedTokens: 0,
        successCount: 0,
        failureCount: 0,
        invalidatedTokens: 0,
      };
    }

    const activeTokens = await this.notificationDeviceTokenModel
      .find({ userId: { $in: recipientUserIds }, isActive: true })
      .select({ fcmToken: 1 })
      .lean();

    const tokens = Array.from(
      new Set(
        activeTokens
          .map((entry) => entry.fcmToken)
          .filter((token): token is string => Boolean(token)),
      ),
    );

    if (tokens.length === 0) {
      return {
        requestedTokens: 0,
        successCount: 0,
        failureCount: 0,
        invalidatedTokens: 0,
      };
    }

    const messaging = this.getMessagingClient();
    const batches = this.createTokenBatches(tokens, 500);
    let successCount = 0;
    let failureCount = 0;
    const deadTokens: string[] = [];

    for (const tokenBatch of batches) {
      const message: MulticastMessage = {
        tokens: tokenBatch,
        notification: {
          title: input.title,
          body: input.body,
        },
        // Android high-priority alert with default sound.
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
          },
        },
        // iOS alert push with default sound and high delivery priority.
        apns: {
          headers: {
            'apns-priority': '10',
            'apns-push-type': 'alert',
          },
          payload: {
            aps: {
              sound: 'default',
              contentAvailable: true,
            },
          },
        },
        data: this.normalizeDataPayload({
          ...input.data,
          severity: input.severity ?? 'warning',
          projectId: input.projectId,
        }),
      };

      const result = await messaging.sendEachForMulticast(message);
      successCount += result.successCount;
      failureCount += result.failureCount;
      this.collectDeadTokens(tokenBatch, result, deadTokens);
    }

    const uniqueDeadTokens = Array.from(new Set(deadTokens));
    if (uniqueDeadTokens.length > 0) {
      await this.invalidateDeviceTokens(uniqueDeadTokens, 'UNREGISTERED');
    }

    return {
      requestedTokens: tokens.length,
      successCount,
      failureCount,
      invalidatedTokens: uniqueDeadTokens.length,
    };
  }

  private getMessagingClient(): Messaging {
    if (this.messagingClient) {
      return this.messagingClient;
    }

    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
    const rawPrivateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');
    const privateKey = rawPrivateKey?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      throw new InternalServerErrorException(
        'Firebase credentials are missing. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.',
      );
    }

    const appName = 'nexusflow-firebase-admin';
    this.firebaseApp =
      getApps().find((app) => app.name === appName) ??
      initializeApp(
        {
          credential: cert({
            projectId,
            clientEmail,
            privateKey,
          }),
        },
        appName,
      );

    this.messagingClient = getMessaging(this.firebaseApp);
    return this.messagingClient;
  }

  private createTokenBatches(tokens: string[], batchSize: number): string[][] {
    const batches: string[][] = [];
    for (let index = 0; index < tokens.length; index += batchSize) {
      batches.push(tokens.slice(index, index + batchSize));
    }
    return batches;
  }

  private normalizeDataPayload(
    data: Record<string, string | number | boolean | undefined>,
  ): Record<string, string> {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || value === null) {
        continue;
      }
      normalized[key] = String(value);
    }
    return normalized;
  }

  private collectDeadTokens(
    tokenBatch: string[],
    result: BatchResponse,
    accumulator: string[],
  ): void {
    result.responses.forEach((response, index) => {
      if (response.success || !response.error) {
        return;
      }

      const code = response.error.code ?? '';
      const isDeadToken =
        this.deadTokenErrorCodes.has(code) ||
        code.includes('registration-token-not-registered') ||
        code.includes('UNREGISTERED');

      if (!isDeadToken) {
        return;
      }

      const deadToken = tokenBatch[index];
      if (deadToken) {
        accumulator.push(deadToken);
      }
    });
  }

  private async invalidateDeviceTokens(
    tokens: string[],
    errorCode: string,
  ): Promise<void> {
    const now = new Date();
    await this.notificationDeviceTokenModel.updateMany(
      { fcmToken: { $in: tokens }, isActive: true },
      {
        $set: {
          isActive: false,
          lastError: errorCode,
          invalidatedAt: now,
        },
      },
    );

    this.logger.warn(
      `Marked ${tokens.length} FCM tokens inactive due to Firebase error: ${errorCode}`,
    );
  }

  private async getProjectRecipientUserIds(projectId: string): Promise<string[]> {
    if (!Types.ObjectId.isValid(projectId)) {
      return [];
    }

    const flow = await this.flowModel
      .findById(projectId)
      .select({ userId: 1 })
      .lean<{ userId?: Types.ObjectId | string }>()
      .exec();

    if (flow?.userId instanceof Types.ObjectId) {
      return [flow.userId.toHexString()];
    }
    if (typeof flow?.userId === 'string' && flow.userId.trim()) {
      return [flow.userId];
    }

    return [];
  }

  private async assertUserCanAccessProject(
    userId: string,
    projectId: string,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(projectId)) {
      throw new ForbiddenException(
        'You are not allowed to access this project alerts.',
      );
    }

    const ownedFlow = await this.flowModel
      .findOne({ _id: projectId, userId })
      .select({ _id: 1 })
      .lean()
      .exec();

    if (!ownedFlow) {
      throw new ForbiddenException(
        'You are not allowed to access this project alerts.',
      );
    }
  }

  private buildHistoryFilter(
    projectId: string,
    cursor: AlertHistoryCursor | null,
  ): FilterQuery<AlertEventDocument> {
    if (!cursor) {
      return { projectId };
    }

    const occurredAt = new Date(cursor.occurredAt);
    const cursorId = this.parseObjectId(cursor.id);
    if (!cursorId || Number.isNaN(occurredAt.getTime())) {
      return { projectId };
    }

    return {
      projectId,
      $or: [
        { occurredAt: { $lt: occurredAt } },
        { occurredAt, _id: { $lt: cursorId } },
      ],
    };
  }

  private parseObjectId(value: string): Types.ObjectId | null {
    if (!Types.ObjectId.isValid(value)) {
      return null;
    }
    return new Types.ObjectId(value);
  }

  private decodeHistoryCursor(cursor?: string): AlertHistoryCursor | null {
    if (!cursor) {
      return null;
    }

    try {
      const decoded = Buffer.from(cursor, 'base64').toString('utf8');
      const parsed: unknown = JSON.parse(decoded);
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }

      const candidate = parsed as Partial<AlertHistoryCursor>;
      if (
        typeof candidate.id !== 'string' ||
        typeof candidate.occurredAt !== 'string'
      ) {
        return null;
      }

      return {
        id: candidate.id,
        occurredAt: candidate.occurredAt,
      };
    } catch {
      return null;
    }
  }

  private encodeHistoryCursor(cursor: AlertHistoryCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64');
  }

  private deduplicatePolicies(
    policies: UpsertAlertPoliciesDto['policies'],
  ): UpsertAlertPoliciesDto['policies'] {
    const deduped = new Map<string, UpsertAlertPoliciesDto['policies'][number]>();
    for (const policy of policies) {
      if (!policy?.sensorType) {
        continue;
      }
      deduped.set(policy.sensorType.trim().toUpperCase(), {
        ...policy,
        sensorType: policy.sensorType.trim().toUpperCase(),
      });
    }
    return Array.from(deduped.values());
  }

  private normalizeRuleActions(
    actions?: CreateAlertRuleDto['actions'],
  ): AlertRuleDocument['actions'] {
    if (!Array.isArray(actions)) {
      return [];
    }

    return actions.map((action) => ({
      type: action.type,
      topic: action.topic,
      templateId: action.templateId,
      payload:
        action.payload && typeof action.payload === 'object'
          ? action.payload
          : undefined,
    }));
  }

  private buildDefaultAlertTitle(input: TriggerAlertDto): string {
    const sensor = input.sensorType.toUpperCase();
    if (input.severity === 'critical') {
      return `${sensor} Critical Alert`;
    }
    if (input.severity === 'warning') {
      return `${sensor} Warning`;
    }
    return `${sensor} Notification`;
  }

  private buildDefaultAlertBody(input: TriggerAlertDto): string {
    const valuePart =
      input.value !== undefined ? `value ${input.value}` : 'a new reading';
    const thresholdPart =
      input.threshold !== undefined ? ` (threshold ${input.threshold})` : '';
    return `${input.sensorType} reported ${valuePart}${thresholdPart}.`;
  }

  private normalizeSensorType(value: string): string {
    return (value ?? '').trim().toUpperCase();
  }

  private matchesOperator(value: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case '>':
        return value > threshold;
      case '<':
        return value < threshold;
      case '>=':
        return value >= threshold;
      case '<=':
        return value <= threshold;
      case '==':
        return value === threshold;
      case '!=':
        return value !== threshold;
      default:
        return false;
    }
  }

  private shouldTriggerRule(cooldownKey: string): boolean {
    const now = Date.now();
    const previous = this.recentRuleTriggers.get(cooldownKey);
    if (previous && now - previous < this.ruleCooldownMs) {
      return false;
    }

    this.recentRuleTriggers.set(cooldownKey, now);
    if (this.recentRuleTriggers.size > 5000) {
      this.pruneRecentRuleTriggers(now);
    }

    return true;
  }

  private pruneRecentRuleTriggers(now: number): void {
    const expiry = now - this.ruleCooldownMs;
    for (const [key, value] of this.recentRuleTriggers.entries()) {
      if (value <= expiry) {
        this.recentRuleTriggers.delete(key);
      }
    }
  }

  private extractPushAction(
    actions: unknown,
  ): { type: 'send_push'; payload?: unknown } | null {
    if (!Array.isArray(actions)) {
      return null;
    }

    const action = actions.find(
      (candidate) =>
        candidate &&
        typeof candidate === 'object' &&
        (candidate as { type?: string }).type === 'send_push',
    );

    if (!action || typeof action !== 'object') {
      return null;
    }

    return action as { type: 'send_push'; payload?: unknown };
  }

  private extractPushPayload(payload: unknown): AlertRuleActionPayload {
    if (!payload || typeof payload !== 'object') {
      return {};
    }

    const candidate = payload as Partial<AlertRuleActionPayload>;
    return {
      title: typeof candidate.title === 'string' ? candidate.title : undefined,
      body: typeof candidate.body === 'string' ? candidate.body : undefined,
    };
  }

  private readPositiveConfigNumber(name: string, fallback: number): number {
    const raw = this.configService.get<string | number>(name);
    if (raw === undefined || raw === null || raw === '') return fallback;

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.trunc(parsed);
  }
}
