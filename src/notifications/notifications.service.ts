import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { App, cert, getApps, initializeApp } from 'firebase-admin/app';
import {
  BatchResponse,
  getMessaging,
  Messaging,
  MulticastMessage,
} from 'firebase-admin/messaging';
import { FilterQuery, Model, Types } from 'mongoose';
import { RegisterNotificationDeviceDto } from './dto/register-notification-device.dto';
import { TriggerAlertDto } from './dto/trigger-alert.dto';
import { AlertEvent, AlertEventDocument } from './schemas/alert-event.schema';
import { AlertHistoryQueryDto } from './dto/alert-history-query.dto';
import {
  AlertPolicy,
  AlertPolicyDocument,
} from './schemas/alert-policy.schema';
import { AlertRule, AlertRuleDocument } from './schemas/alert-rule.schema';
import { Flow, FlowDocument } from 'src/flows/schemas/flow.schema';
import {
  NotificationPreference,
  NotificationPreferenceDocument,
} from './schemas/notification-preference.schema';
import {
  AlertComparisonOperator,
  UpsertAlertPoliciesDto,
} from './dto/upsert-alert-policies.dto';
import {
  AlertRuleOperator,
  CreateAlertRuleDto,
} from './dto/create-alert-rule.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { UpdateAlertRuleDto } from './dto/update-alert-rule.dto';
import {
  NotificationDeviceToken,
  NotificationDeviceTokenDocument,
} from './schemas/notification-device-token.schema';

type AlertSeverity = 'critical' | 'warning' | 'info';

const ALERT_SEVERITIES: AlertSeverity[] = ['critical', 'warning', 'info'];

type ProcessSensorReadingInput = {
  flowId: string;
  nodeId: string;
  readings: Record<string, number>;
  occurredAt?: Date;
  metadata?: Record<string, string | number | boolean>;
};

type DeviceRegistrationResponse = {
  id: string;
  deviceId: string;
  platform: 'android' | 'ios';
  appVersion?: string;
  locale?: string;
  registeredAt?: Date;
  updatedAt?: Date;
};

type AlertHistoryItem = {
  id: string;
  flowId: string;
  ruleId: string;
  nodeId: string;
  moduleId: string;
  readingKey: string;
  severity: AlertSeverity;
  title: string;
  body: string;
  value: number;
  operator: AlertRuleOperator;
  threshold: number | null;
  min: number | null;
  max: number | null;
  occurredAt: Date;
  notificationReceived: boolean;
  notificationHandled: boolean;
  createdAt?: Date;
};

type AlertDeliveryState = {
  historyId: string;
  flowId: string;
  ruleId: string;
  nodeId: string;
  notificationReceived: boolean;
  notificationHandled: boolean;
  notificationReceivedAt?: Date | null;
  notificationHandledAt?: Date | null;
};

type RuleOutput = {
  id: string;
  flowId: string;
  nodeId: string;
  moduleId: string;
  readingKey: string;
  operator: AlertRuleOperator;
  threshold: number | null;
  min: number | null;
  max: number | null;
  severity: AlertSeverity;
  enabled: boolean;
  actions: unknown[];
  createdAt?: Date;
  updatedAt?: Date;
};

type PolicyOutput = {
  id: string;
  moduleId: string;
  readingKey: string;
  label: string;
  required: boolean;
  thresholdRequired: boolean;
  defaultEnabled: boolean;
  defaultSeverity: AlertSeverity;
  defaultOperator: AlertRuleOperator;
  defaultThreshold: number | null;
  defaultMin: number | null;
  defaultMax: number | null;
  supportedOperators: AlertComparisonOperator[];
  isActive: boolean;
};

const SIMPLE_OPERATORS: AlertRuleOperator[] = ['>', '<', '>=', '<=', '='];
const RANGE_OPERATORS: AlertRuleOperator[] = ['between', 'outside'];
const ALL_OPERATORS = new Set<AlertRuleOperator>([
  '>',
  '<',
  '>=',
  '<=',
  '=',
  'between',
  'outside',
]);

const MODULE_READING_KEYS: Record<string, string[]> = {
  'MQ2-Sensor': ['analog', 'digital'],
  'DHT-Sensor-11': ['temperature', 'humidity'],
  'DHT-Sensor-22': ['temperature', 'humidity'],
  'PIR-Sensor': ['motion'],
  'Rain-Sensor': ['analog', 'digital'],
  'Soil-Sensor': ['analog', 'digital'],
  'Ultrasonic-Sensor': ['distance_cm'],
  'ESP32-gpio-input': ['result'],
  'ESP32-gpio-input-pullup': ['result'],
  'ESP32-gpio-input-analog': ['raw', 'result'],
};

const GAS_SENSOR_MODULE_ID = 'MQ2-Sensor';
const DEFAULT_HISTORY_SINCE_HOURS = 24;
const MAX_HISTORY_SINCE_HOURS = 720;
const DEFAULT_RECEIVED_REMINDER_MS = 10 * 60 * 1000;
const DEFAULT_HANDLED_COOLDOWN_MS = 60 * 60 * 1000;

type BaselinePolicyInput = {
  moduleId: string;
  readingKey: string;
  label: string;
  required: boolean;
  thresholdRequired: boolean;
  defaultEnabled: boolean;
  defaultSeverity: AlertSeverity;
  defaultOperator: AlertRuleOperator;
  defaultThreshold: number | null;
  defaultMin: number | null;
  defaultMax: number | null;
  supportedOperators: AlertComparisonOperator[];
  isActive: boolean;
};

const SIMPLE_AND_RANGE_OPERATORS: AlertComparisonOperator[] = [
  '>',
  '<',
  '>=',
  '<=',
  '=',
  'between',
  'outside',
];

const EQUALS_ONLY_OPERATOR: AlertComparisonOperator[] = ['='];

const BASELINE_ALERT_POLICIES: BaselinePolicyInput[] = [
  {
    moduleId: 'MQ2-Sensor',
    readingKey: 'analog',
    label: 'MQ2 Gas Level (Analog)',
    required: true,
    thresholdRequired: true,
    defaultEnabled: true,
    defaultSeverity: 'critical',
    defaultOperator: '>',
    defaultThreshold: 300,
    defaultMin: null,
    defaultMax: null,
    supportedOperators: SIMPLE_AND_RANGE_OPERATORS,
    isActive: true,
  },
  {
    moduleId: 'MQ2-Sensor',
    readingKey: 'digital',
    label: 'MQ2 Gas Detected (Digital)',
    required: false,
    thresholdRequired: true,
    defaultEnabled: true,
    defaultSeverity: 'critical',
    defaultOperator: '=',
    defaultThreshold: 1,
    defaultMin: null,
    defaultMax: null,
    supportedOperators: EQUALS_ONLY_OPERATOR,
    isActive: true,
  },
  {
    moduleId: 'DHT-Sensor-11',
    readingKey: 'temperature',
    label: 'Temperature (DHT11)',
    required: false,
    thresholdRequired: true,
    defaultEnabled: true,
    defaultSeverity: 'warning',
    defaultOperator: 'outside',
    defaultThreshold: null,
    defaultMin: 15,
    defaultMax: 35,
    supportedOperators: SIMPLE_AND_RANGE_OPERATORS,
    isActive: true,
  },
  {
    moduleId: 'DHT-Sensor-11',
    readingKey: 'humidity',
    label: 'Humidity (DHT11)',
    required: false,
    thresholdRequired: true,
    defaultEnabled: true,
    defaultSeverity: 'warning',
    defaultOperator: 'outside',
    defaultThreshold: null,
    defaultMin: 30,
    defaultMax: 80,
    supportedOperators: SIMPLE_AND_RANGE_OPERATORS,
    isActive: true,
  },
  {
    moduleId: 'DHT-Sensor-22',
    readingKey: 'temperature',
    label: 'Temperature (DHT22)',
    required: false,
    thresholdRequired: true,
    defaultEnabled: true,
    defaultSeverity: 'warning',
    defaultOperator: 'outside',
    defaultThreshold: null,
    defaultMin: 15,
    defaultMax: 35,
    supportedOperators: SIMPLE_AND_RANGE_OPERATORS,
    isActive: true,
  },
  {
    moduleId: 'DHT-Sensor-22',
    readingKey: 'humidity',
    label: 'Humidity (DHT22)',
    required: false,
    thresholdRequired: true,
    defaultEnabled: true,
    defaultSeverity: 'warning',
    defaultOperator: 'outside',
    defaultThreshold: null,
    defaultMin: 30,
    defaultMax: 80,
    supportedOperators: SIMPLE_AND_RANGE_OPERATORS,
    isActive: true,
  },
  {
    moduleId: 'PIR-Sensor',
    readingKey: 'motion',
    label: 'Motion Detected',
    required: false,
    thresholdRequired: true,
    defaultEnabled: true,
    defaultSeverity: 'warning',
    defaultOperator: '=',
    defaultThreshold: 1,
    defaultMin: null,
    defaultMax: null,
    supportedOperators: EQUALS_ONLY_OPERATOR,
    isActive: true,
  },
  {
    moduleId: 'Rain-Sensor',
    readingKey: 'analog',
    label: 'Rain Intensity (Analog)',
    required: false,
    thresholdRequired: true,
    defaultEnabled: true,
    defaultSeverity: 'warning',
    defaultOperator: '>',
    defaultThreshold: 1500,
    defaultMin: null,
    defaultMax: null,
    supportedOperators: SIMPLE_AND_RANGE_OPERATORS,
    isActive: true,
  },
  {
    moduleId: 'Rain-Sensor',
    readingKey: 'digital',
    label: 'Rain Detected (Digital)',
    required: false,
    thresholdRequired: true,
    defaultEnabled: true,
    defaultSeverity: 'warning',
    defaultOperator: '=',
    defaultThreshold: 1,
    defaultMin: null,
    defaultMax: null,
    supportedOperators: EQUALS_ONLY_OPERATOR,
    isActive: true,
  },
  {
    moduleId: 'Soil-Sensor',
    readingKey: 'analog',
    label: 'Soil Moisture (Analog)',
    required: false,
    thresholdRequired: true,
    defaultEnabled: true,
    defaultSeverity: 'warning',
    defaultOperator: '>',
    defaultThreshold: 2500,
    defaultMin: null,
    defaultMax: null,
    supportedOperators: SIMPLE_AND_RANGE_OPERATORS,
    isActive: true,
  },
  {
    moduleId: 'Soil-Sensor',
    readingKey: 'digital',
    label: 'Soil Dry Detected (Digital)',
    required: false,
    thresholdRequired: true,
    defaultEnabled: true,
    defaultSeverity: 'warning',
    defaultOperator: '=',
    defaultThreshold: 1,
    defaultMin: null,
    defaultMax: null,
    supportedOperators: EQUALS_ONLY_OPERATOR,
    isActive: true,
  },
  {
    moduleId: 'Ultrasonic-Sensor',
    readingKey: 'distance_cm',
    label: 'Distance (cm)',
    required: false,
    thresholdRequired: true,
    defaultEnabled: true,
    defaultSeverity: 'warning',
    defaultOperator: 'outside',
    defaultThreshold: null,
    defaultMin: 2,
    defaultMax: 400,
    supportedOperators: SIMPLE_AND_RANGE_OPERATORS,
    isActive: true,
  },
];

@Injectable()
export class NotificationsService implements OnModuleInit {
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
  private readonly gasRuleMaxBackoffMs: number;
  private readonly receivedReminderMs: number;
  private readonly handledCooldownMs: number;
  private readonly handledCooldownByModuleSeverityMs: Map<string, number>;
  private readonly handledCooldownByModuleMs: Map<string, number>;
  private readonly handledCooldownBySeverityMs: Map<AlertSeverity, number>;
  private readonly gasRuleBackoffState = new Map<
    string,
    { lastTriggeredAtMs: number; nextDelayMs: number }
  >();

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
    private readonly configService: ConfigService
  ) {
    this.ruleCooldownMs = this.readPositiveConfigNumber(
      'ALERT_RULE_COOLDOWN_MS',
      60000
    );
    this.gasRuleMaxBackoffMs = this.readPositiveConfigNumber(
      'ALERT_RULE_MAX_BACKOFF_MS',
      15 * 60000
    );
    this.receivedReminderMs = this.readPositiveConfigNumber(
      'ALERT_RECEIVED_REMINDER_MS',
      DEFAULT_RECEIVED_REMINDER_MS
    );
    this.handledCooldownMs = this.readPositiveConfigNumber(
      'ALERT_HANDLED_COOLDOWN_MS',
      DEFAULT_HANDLED_COOLDOWN_MS
    );
    this.handledCooldownByModuleSeverityMs = this.readDurationMapConfig(
      'ALERT_HANDLED_COOLDOWN_BY_MODULE_SEVERITY_MS',
      (key) => this.normalizeModuleSeverityKey(key)
    );
    this.handledCooldownByModuleMs = this.readDurationMapConfig(
      'ALERT_HANDLED_COOLDOWN_BY_MODULE_MS',
      (key) => key.trim()
    );
    this.handledCooldownBySeverityMs = this.readSeverityDurationMapConfig(
      'ALERT_HANDLED_COOLDOWN_BY_SEVERITY_MS'
    );
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBaselinePolicies();
  }

  async registerDeviceToken(
    userId: string,
    dto: RegisterNotificationDeviceDto
  ): Promise<DeviceRegistrationResponse> {
    await this.notificationDeviceTokenModel.deleteMany({
      fcmToken: dto.fcmToken,
      $or: [{ userId: { $ne: userId } }, { deviceId: { $ne: dto.deviceId } }],
    });

    const now = new Date();
    const existing = await this.notificationDeviceTokenModel
      .findOne({ userId, deviceId: dto.deviceId })
      .exec();

    if (!existing) {
      const created = await this.notificationDeviceTokenModel.create({
        userId,
        deviceId: dto.deviceId,
        platform: dto.platform,
        fcmToken: dto.fcmToken,
        appVersion: dto.appVersion,
        locale: dto.locale,
        isActive: true,
        lastError: null,
        invalidatedAt: null,
        lastSeenAt: now,
      });

      return {
        id: this.toObjectIdString(created),
        deviceId: dto.deviceId,
        platform: dto.platform,
        appVersion: dto.appVersion,
        locale: dto.locale,
        registeredAt: created.createdAt ?? now,
      };
    }

    existing.platform = dto.platform;
    existing.fcmToken = dto.fcmToken;
    existing.appVersion = dto.appVersion;
    existing.locale = dto.locale;
    existing.isActive = true;
    existing.lastError = undefined;
    existing.invalidatedAt = undefined;
    existing.lastSeenAt = now;
    await existing.save();

    return {
      id: this.toObjectIdString(existing),
      deviceId: dto.deviceId,
      platform: dto.platform,
      appVersion: dto.appVersion,
      locale: dto.locale,
      updatedAt: existing.updatedAt ?? now,
    };
  }

  async unregisterDeviceToken(
    userId: string,
    deviceId: string
  ): Promise<boolean> {
    const normalizedDeviceId = deviceId.trim();
    if (!normalizedDeviceId) {
      return false;
    }

    const deleted = await this.notificationDeviceTokenModel
      .deleteOne({ userId, deviceId: normalizedDeviceId })
      .exec();
    return (deleted.deletedCount ?? 0) > 0;
  }

  async getAlertPolicies(moduleId?: string): Promise<{
    items: PolicyOutput[];
  }> {
    const filter: FilterQuery<AlertPolicyDocument> = {};
    if (moduleId?.trim()) {
      filter.moduleId = moduleId.trim();
    }

    const policies = await this.alertPolicyModel
      .find(filter)
      .sort({ moduleId: 1, readingKey: 1 })
      .lean()
      .exec();

    return {
      items: policies.map((policy) => this.mapPolicy(policy)),
    };
  }

  async upsertAlertPolicies(dto: UpsertAlertPoliciesDto): Promise<{
    upserted: number;
    items: PolicyOutput[];
  }> {
    const normalized = this.deduplicatePolicies(dto.policies ?? []);
    if (!normalized.length) {
      return { upserted: 0, items: [] };
    }

    const operations = normalized.map((policy) => ({
      updateOne: {
        filter: {
          moduleId: policy.moduleId,
          readingKey: this.normalizeReadingKey(policy.readingKey),
        },
        update: {
          $set: {
            moduleId: policy.moduleId,
            readingKey: this.normalizeReadingKey(policy.readingKey),
            label: policy.label.trim(),
            required: policy.required,
            thresholdRequired: policy.thresholdRequired,
            defaultEnabled: policy.defaultEnabled,
            defaultSeverity: policy.defaultSeverity,
            defaultOperator: policy.defaultOperator,
            defaultThreshold: policy.defaultThreshold ?? null,
            defaultMin: policy.defaultMin ?? null,
            defaultMax: policy.defaultMax ?? null,
            supportedOperators: this.normalizeSupportedOperators(
              policy.supportedOperators
            ),
            isActive: policy.isActive,
          },
        },
        upsert: true,
      },
    }));

    const result = await this.alertPolicyModel.bulkWrite(operations, {
      ordered: false,
    });

    const filters = normalized.map((entry) => ({
      moduleId: entry.moduleId,
      readingKey: this.normalizeReadingKey(entry.readingKey),
    }));
    const items = await this.alertPolicyModel
      .find({ $or: filters })
      .lean()
      .exec();

    return {
      upserted: (result.upsertedCount ?? 0) + (result.modifiedCount ?? 0),
      items: items.map((policy) => this.mapPolicy(policy)),
    };
  }

  async deleteAlertPolicy(policyId: string): Promise<void> {
    const objectId = new Types.ObjectId(policyId);
    const result = await this.alertPolicyModel
      .deleteOne({ _id: objectId })
      .exec();

    if ((result.deletedCount ?? 0) === 0) {
      throw new NotFoundException('Alert policy not found');
    }
  }

  async getNotificationPreferences(
    userId: string,
    flowId: string
  ): Promise<{
    id: string;
    flowId: string;
    notificationsEnabled: boolean;
    channels: string[];
  }> {
    await this.assertUserCanAccessFlow(userId, flowId);

    const preference = await this.notificationPreferenceModel
      .findOne(this.buildPreferenceFilter(flowId, userId))
      .lean()
      .exec();
    if (!preference) {
      throw new NotFoundException('Preferences not found for this flow.');
    }

    return {
      id: String(preference._id),
      flowId: preference.flowId,
      notificationsEnabled: preference.notificationsEnabled,
      channels: Array.isArray(preference.channels)
        ? preference.channels
        : ['push'],
    };
  }

  async updateNotificationPreferences(
    userId: string,
    flowId: string,
    dto: UpdateNotificationPreferencesDto
  ): Promise<{
    id: string;
    flowId: string;
    notificationsEnabled: boolean;
    channels: string[];
  }> {
    await this.assertUserCanAccessFlow(userId, flowId);

    // Check if flow has alert rules before allowing notifications to be enabled
    if (dto.notificationsEnabled) {
      const hasRules = await this.hasAlertRulesForFlow(flowId, userId);
      if (!hasRules) {
        throw new BadRequestException(
          'Cannot enable notifications for a flow with no alert rules. Please create an alert rule first.'
        );
      }
    }

    const normalizedChannels = this.normalizeChannels(dto.channels);

    const existing = await this.notificationPreferenceModel
      .findOne(this.buildPreferenceFilter(flowId, userId))
      .exec();

    const updated =
      existing ??
      new this.notificationPreferenceModel({
        flowId,
        projectId: flowId,
        userId,
      });

    updated.flowId = flowId;
    updated.projectId = flowId;
    updated.notificationsEnabled = dto.notificationsEnabled;
    updated.channels = normalizedChannels;

    await updated.save();

    return {
      id: this.toObjectIdString(updated),
      flowId,
      notificationsEnabled: dto.notificationsEnabled,
      channels: normalizedChannels,
    };
  }

  async getNotificationStatesForFlows(
    userId: string,
    flowIds: string[]
  ): Promise<Map<string, boolean>> {
    const normalizedFlowIds = Array.from(
      new Set(
        flowIds
          .map((flowId) => flowId.trim())
          .filter((flowId) => flowId.length > 0)
      )
    );

    if (!normalizedFlowIds.length) {
      return new Map<string, boolean>();
    }

    const preferences = await this.notificationPreferenceModel
      .find({
        userId,
        $or: [
          { flowId: { $in: normalizedFlowIds } },
          { projectId: { $in: normalizedFlowIds } },
        ],
      })
      .select({ flowId: 1, projectId: 1, notificationsEnabled: 1 })
      .lean()
      .exec();

    const states = new Map<string, boolean>();
    for (const preference of preferences) {
      const key =
        typeof preference.flowId === 'string' && preference.flowId.trim()
          ? preference.flowId
          : (preference.projectId ?? '');
      if (!key) {
        continue;
      }
      states.set(key, preference.notificationsEnabled);
    }

    return states;
  }

  async getAlertRules(
    userId: string,
    flowId: string,
    nodeId?: string
  ): Promise<{ items: RuleOutput[] }> {
    await this.assertUserCanAccessFlow(userId, flowId);

    const filter: FilterQuery<AlertRuleDocument> = { flowId, userId };
    if (nodeId?.trim()) {
      filter.nodeId = nodeId.trim();
    }

    const rules = await this.alertRuleModel
      .find(filter)
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean()
      .exec();

    return { items: rules.map((rule) => this.mapRule(rule)) };
  }

  async getAlertRule(
    userId: string,
    flowId: string,
    ruleId: string
  ): Promise<RuleOutput> {
    await this.assertUserCanAccessFlow(userId, flowId);
    const rule = await this.alertRuleModel
      .findOne({ _id: ruleId, flowId, userId })
      .lean()
      .exec();
    if (!rule) {
      throw new NotFoundException('Alert rule not found.');
    }

    return this.mapRule(rule);
  }

  async createAlertRule(
    userId: string,
    flowId: string,
    dto: CreateAlertRuleDto
  ): Promise<RuleOutput> {
    const flow = await this.assertUserCanAccessFlow(userId, flowId);
    this.assertNodeBelongsToFlow(flow, dto.nodeId, dto.moduleId);
    this.assertReadingKeyAllowed(dto.moduleId, dto.readingKey);

    const policy = await this.findPolicyForRule(dto.moduleId, dto.readingKey);
    this.validateRuleCondition({
      operator: dto.operator,
      threshold: dto.threshold,
      min: dto.min,
      max: dto.max,
    });

    if (policy?.required && dto.enabled === false) {
      throw new ForbiddenException(
        'This alert rule is required by policy and cannot be disabled.'
      );
    }

    try {
      const created = await this.alertRuleModel.create({
        flowId,
        userId,
        nodeId: dto.nodeId.trim(),
        moduleId: dto.moduleId.trim(),
        readingKey: this.normalizeReadingKey(dto.readingKey),
        operator: dto.operator,
        threshold: dto.threshold === undefined ? null : (dto.threshold ?? null),
        min: dto.min === undefined ? null : (dto.min ?? null),
        max: dto.max === undefined ? null : (dto.max ?? null),
        severity: dto.severity,
        enabled: dto.enabled,
        actions: this.normalizeRuleActions(dto.actions),
      });

      return this.mapRule(created.toObject());
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: number }).code === 11000
      ) {
        throw new BadRequestException(
          'An alert rule for this node and reading key already exists.'
        );
      }
      throw error;
    }
  }

  async updateAlertRule(
    userId: string,
    flowId: string,
    ruleId: string,
    dto: UpdateAlertRuleDto
  ): Promise<RuleOutput> {
    const flow = await this.assertUserCanAccessFlow(userId, flowId);
    const existing = await this.alertRuleModel
      .findOne({ _id: ruleId, flowId, userId })
      .exec();
    if (!existing) {
      throw new NotFoundException('Alert rule not found.');
    }

    const candidate = {
      nodeId: dto.nodeId ?? existing.nodeId,
      moduleId: dto.moduleId ?? existing.moduleId,
      readingKey: dto.readingKey ?? existing.readingKey,
      operator: dto.operator ?? existing.operator,
      threshold:
        dto.threshold !== undefined
          ? dto.threshold
          : (existing.threshold ?? null),
      min: dto.min !== undefined ? dto.min : (existing.min ?? null),
      max: dto.max !== undefined ? dto.max : (existing.max ?? null),
      severity: dto.severity ?? existing.severity,
      enabled: dto.enabled ?? existing.enabled,
      actions:
        dto.actions !== undefined ? dto.actions : (existing.actions ?? []),
    };

    this.assertNodeBelongsToFlow(flow, candidate.nodeId, candidate.moduleId);
    this.assertReadingKeyAllowed(candidate.moduleId, candidate.readingKey);
    this.validateRuleCondition({
      operator: candidate.operator,
      threshold: candidate.threshold,
      min: candidate.min,
      max: candidate.max,
    });

    const policy = await this.findPolicyForRule(
      candidate.moduleId,
      candidate.readingKey
    );
    if (policy?.required && candidate.enabled === false) {
      throw new ForbiddenException(
        'This alert rule is required by policy and cannot be disabled.'
      );
    }

    existing.nodeId = candidate.nodeId.trim();
    existing.moduleId = candidate.moduleId.trim();
    existing.readingKey = this.normalizeReadingKey(candidate.readingKey);
    existing.operator = candidate.operator;
    existing.threshold =
      candidate.threshold === undefined ? null : (candidate.threshold ?? null);
    existing.min = candidate.min === undefined ? null : (candidate.min ?? null);
    existing.max = candidate.max === undefined ? null : (candidate.max ?? null);
    existing.severity = candidate.severity;
    existing.enabled = candidate.enabled;
    existing.actions = this.normalizeRuleActions(candidate.actions);

    await existing.save();
    return this.mapRule(existing.toObject());
  }

  async deleteAlertRule(
    userId: string,
    flowId: string,
    ruleId: string
  ): Promise<void> {
    await this.assertUserCanAccessFlow(userId, flowId);

    const existing = await this.alertRuleModel
      .findOne({ _id: ruleId, flowId, userId })
      .exec();
    if (!existing) {
      throw new NotFoundException('Alert rule not found.');
    }

    const policy = await this.findPolicyForRule(
      existing.moduleId,
      existing.readingKey
    );
    // `required` controls persistence (delete protection), not runtime firing.
    if (policy?.required) {
      throw new ForbiddenException(
        'This alert rule is required by policy and cannot be deleted.'
      );
    }

    await this.alertRuleModel.deleteOne({ _id: existing._id }).exec();
  }

  async getAlertHistory(
    userId: string,
    flowId: string,
    query: AlertHistoryQueryDto
  ): Promise<{
    items: AlertHistoryItem[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    await this.assertUserCanAccessFlow(userId, flowId);

    const parsedLimit = Number(query.limit);
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 100)
        : 50;

    const parsedSinceHours = Number(query.since);
    const sinceHours =
      Number.isFinite(parsedSinceHours) && parsedSinceHours > 0
        ? Math.min(Math.trunc(parsedSinceHours), MAX_HISTORY_SINCE_HOURS)
        : DEFAULT_HISTORY_SINCE_HOURS;
    const fromDate = new Date(Date.now() - sinceHours * 60 * 60 * 1000);

    const filter: FilterQuery<AlertEventDocument> = { flowId };
    filter.occurredAt = { $gte: fromDate };
    if (query.nodeId?.trim()) {
      filter.nodeId = query.nodeId.trim();
    }
    if (query.severity) {
      filter.severity = query.severity;
    }

    const cursorClause = await this.buildCursorFilterClause(
      flowId,
      query.cursor,
      filter
    );
    if (cursorClause) {
      filter.$and = filter.$and
        ? [...filter.$and, cursorClause]
        : [cursorClause];
    }

    const events = await this.alertEventModel
      .find(filter)
      .sort({ occurredAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean()
      .exec();

    const hasMore = events.length > limit;
    const selected = hasMore ? events.slice(0, limit) : events;
    const items: AlertHistoryItem[] = selected.map((event) => ({
      id: String(event._id),
      flowId: event.flowId,
      ruleId: event.ruleId,
      nodeId: event.nodeId,
      moduleId: event.moduleId,
      readingKey: event.readingKey,
      severity: event.severity,
      title: event.title,
      body: event.body,
      value: event.value ?? 0,
      operator: event.operator,
      threshold: event.threshold ?? null,
      min: event.min ?? null,
      max: event.max ?? null,
      occurredAt: event.occurredAt,
      notificationReceived: Boolean(event.notificationReceived),
      notificationHandled: Boolean(event.notificationHandled),
      createdAt: event.createdAt,
    }));

    const nextCursor = hasMore
      ? String(selected[selected.length - 1]._id)
      : null;

    return { items, nextCursor, hasMore };
  }

  async markAlertNotificationReceived(
    userId: string,
    historyId: string
  ): Promise<AlertDeliveryState> {
    const event = await this.getOwnedAlertEventOrThrow(userId, historyId);
    const now = new Date();

    if (!event.notificationReceived) {
      event.notificationReceived = true;
      event.notificationReceivedAt = now;
    }
    if (!event.notificationLastSentAt) {
      event.notificationLastSentAt = event.createdAt ?? now;
    }
    if (!event.notificationHandled) {
      event.notificationNextReminderAt = new Date(
        (event.notificationLastSentAt ?? now).getTime() +
          this.receivedReminderMs
      );
    }

    await event.save();
    return this.mapAlertDeliveryState(event);
  }

  async markAlertNotificationHandled(
    userId: string,
    historyId: string
  ): Promise<AlertDeliveryState> {
    const event = await this.getOwnedAlertEventOrThrow(userId, historyId);
    const now = new Date();

    if (!event.notificationReceived) {
      event.notificationReceived = true;
      event.notificationReceivedAt = now;
    }
    if (!event.notificationHandled) {
      event.notificationHandled = true;
      event.notificationHandledAt = now;
    }
    event.notificationNextReminderAt = null;

    await event.save();
    return this.mapAlertDeliveryState(event);
  }

  async triggerAlertFromInternal(input: TriggerAlertDto): Promise<{
    triggered: boolean;
    historyId?: string;
    pushSent: boolean;
    message?: string;
    reason?: string;
  }> {
    const rule = await this.alertRuleModel
      .findOne({
        _id: input.ruleId,
        flowId: input.flowId,
        nodeId: input.nodeId,
        moduleId: input.moduleId,
        readingKey: this.normalizeReadingKey(input.readingKey),
        enabled: true,
      })
      .exec();
    if (!rule) {
      throw new NotFoundException('Rule not found.');
    }

    this.validateRuleCondition({
      operator: input.operator,
      threshold: input.threshold,
      min: input.min,
      max: input.max,
    });
    const conditionMatched = this.matchesOperator({
      operator: input.operator,
      value: input.value,
      threshold: input.threshold ?? null,
      min: input.min ?? null,
      max: input.max ?? null,
    });
    if (!conditionMatched) {
      return {
        triggered: false,
        reason: 'Reading does not satisfy the provided rule condition.',
        pushSent: false,
      };
    }

    const flowOwnerId = await this.getFlowOwnerId(input.flowId);
    if (!flowOwnerId) {
      throw new NotFoundException('Flow not found.');
    }

    const preference = await this.notificationPreferenceModel
      .findOne(this.buildPreferenceFilter(input.flowId, flowOwnerId))
      .lean()
      .exec();

    const notificationsEnabled = this.resolvePreferenceEnabled(preference);
    if (!notificationsEnabled) {
      return {
        triggered: false,
        reason: 'Notifications are disabled for this flow via preferences.',
        pushSent: false,
      };
    }

    const occurredAt = input.occurredAt
      ? new Date(input.occurredAt)
      : new Date();
    const fired = await this.fireAlertFromRule({
      flowId: input.flowId,
      rule,
      value: input.value,
      occurredAt,
      metadata: { source: 'internal-trigger' },
    });

    if (fired.suppressed) {
      return {
        triggered: false,
        historyId: fired.historyId,
        pushSent: false,
        reason: fired.reason,
      };
    }

    return {
      triggered: true,
      historyId: fired.historyId,
      pushSent: fired.pushSent,
      message: fired.pushSent
        ? 'Alert fired and push notification sent.'
        : 'Alert fired but no active push tokens were available.',
    };
  }

  async processSensorReading(input: ProcessSensorReadingInput): Promise<{
    evaluatedRules: number;
    triggeredRules: number;
  }> {
    if (!Types.ObjectId.isValid(input.flowId) || !input.nodeId?.trim()) {
      return { evaluatedRules: 0, triggeredRules: 0 };
    }

    const flowOwnerId = await this.getFlowOwnerId(input.flowId);
    if (!flowOwnerId) {
      return { evaluatedRules: 0, triggeredRules: 0 };
    }

    const preference = await this.notificationPreferenceModel
      .findOne(this.buildPreferenceFilter(input.flowId, flowOwnerId))
      .lean()
      .exec();
    const notificationsEnabled = this.resolvePreferenceEnabled(preference);
    if (!notificationsEnabled) {
      return { evaluatedRules: 0, triggeredRules: 0 };
    }

    const rules = await this.alertRuleModel
      .find({
        flowId: input.flowId,
        nodeId: input.nodeId.trim(),
        enabled: true,
      })
      .lean()
      .exec();
    if (!rules.length) {
      return { evaluatedRules: 0, triggeredRules: 0 };
    }

    let evaluatedRules = 0;
    let triggeredRules = 0;
    const occurredAt = input.occurredAt ?? new Date();

    for (const rule of rules) {
      const value = input.readings[this.normalizeReadingKey(rule.readingKey)];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        continue;
      }

      const cooldownKey = `${input.flowId}:${this.toObjectIdString(rule)}`;
      evaluatedRules++;
      const matches = this.matchesOperator({
        operator: rule.operator,
        value,
        threshold: rule.threshold ?? null,
        min: rule.min ?? null,
        max: rule.max ?? null,
      });
      if (!matches) {
        this.resetRuleTriggerState(cooldownKey, rule.moduleId);
        continue;
      }

      if (!this.shouldTriggerRule(cooldownKey, rule.moduleId, occurredAt)) {
        continue;
      }

      const fired = await this.fireAlertFromRule({
        flowId: input.flowId,
        rule,
        value,
        occurredAt,
        metadata: input.metadata,
      });
      if (fired.suppressed) {
        continue;
      }
      triggeredRules++;
    }

    return { evaluatedRules, triggeredRules };
  }

  async syncRulesForFlowNodes(params: {
    flowId: string;
    userId: string;
    nodes: Array<{ nodeId: string; moduleId: string }>;
  }): Promise<void> {
    if (!params.flowId || !params.userId) {
      return;
    }

    const normalizedNodes = params.nodes
      .map((node) => ({
        nodeId: node.nodeId.trim(),
        moduleId: node.moduleId.trim(),
      }))
      .filter((node) => node.nodeId && node.moduleId);

    const nodeMap = new Map(normalizedNodes.map((node) => [node.nodeId, node]));
    const existingRules = await this.alertRuleModel
      .find({ flowId: params.flowId, userId: params.userId })
      .exec();

    const staleRuleIds = existingRules
      .filter((rule) => !nodeMap.has(rule.nodeId))
      .map((rule) => rule._id);
    if (staleRuleIds.length) {
      await this.alertRuleModel
        .deleteMany({ _id: { $in: staleRuleIds } })
        .exec();
    }

    const activePolicies = await this.alertPolicyModel
      .find({ isActive: true })
      .lean()
      .exec();
    const policiesByModule = new Map<string, typeof activePolicies>();
    for (const policy of activePolicies) {
      const key = policy.moduleId.trim();
      const items = policiesByModule.get(key) ?? [];
      items.push(policy);
      policiesByModule.set(key, items);
    }

    const existingKeySet = new Set(
      existingRules.map(
        (rule) => `${rule.nodeId}::${this.normalizeReadingKey(rule.readingKey)}`
      )
    );

    const defaultActions = (label: string) => [
      {
        type: 'send_push' as const,
        payload: {
          title: `${label} Alert`,
          body: `${label} threshold exceeded`,
        },
      },
    ];

    const toInsert: Partial<AlertRule>[] = [];
    for (const node of normalizedNodes) {
      const policies = policiesByModule.get(node.moduleId) ?? [];
      for (const policy of policies) {
        const readingKey = this.normalizeReadingKey(policy.readingKey);
        const ruleKey = `${node.nodeId}::${readingKey}`;
        if (existingKeySet.has(ruleKey)) {
          continue;
        }

        const policyDefaults = this.resolvePolicyDefaults(policy);
        toInsert.push({
          flowId: params.flowId,
          userId: params.userId,
          nodeId: node.nodeId,
          moduleId: node.moduleId,
          readingKey,
          operator: policyDefaults.operator,
          threshold: policyDefaults.threshold,
          min: policyDefaults.min,
          max: policyDefaults.max,
          severity: policy.defaultSeverity,
          enabled: policy.defaultEnabled && policyDefaults.isValidCondition,
          actions: defaultActions(policy.label),
        });
      }
    }

    if (toInsert.length) {
      await this.alertRuleModel.insertMany(toInsert, { ordered: false });
    }
  }

  async cleanupFlowNotificationData(flowId: string): Promise<void> {
    await Promise.all([
      this.alertRuleModel.deleteMany({ flowId }).exec(),
      this.alertEventModel.deleteMany({ flowId }).exec(),
      this.notificationPreferenceModel
        .deleteMany({
          $or: [{ flowId }, { projectId: flowId }],
        })
        .exec(),
    ]);
  }

  private async ensureBaselinePolicies(): Promise<void> {
    try {
      const operations = BASELINE_ALERT_POLICIES.map((policy) => ({
        updateOne: {
          filter: {
            moduleId: policy.moduleId.trim(),
            readingKey: this.normalizeReadingKey(policy.readingKey),
          },
          update: {
            $setOnInsert: {
              moduleId: policy.moduleId.trim(),
              readingKey: this.normalizeReadingKey(policy.readingKey),
              label: policy.label.trim(),
              required: policy.required,
              thresholdRequired: policy.thresholdRequired,
              defaultEnabled: policy.defaultEnabled,
              defaultSeverity: policy.defaultSeverity,
              defaultOperator: policy.defaultOperator,
              defaultThreshold: policy.defaultThreshold,
              defaultMin: policy.defaultMin,
              defaultMax: policy.defaultMax,
              supportedOperators: policy.supportedOperators,
              isActive: policy.isActive,
            },
          },
          upsert: true,
        },
      }));

      await this.alertPolicyModel.bulkWrite(operations, { ordered: false });
    } catch (error) {
      this.logger.warn(
        `Failed to ensure baseline alert policies: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }

  private async fireAlertFromRule(params: {
    flowId: string;
    rule: AlertRuleDocument | (AlertRule & { _id: unknown });
    value: number;
    occurredAt: Date;
    metadata?: Record<string, string | number | boolean>;
  }): Promise<{
    historyId: string;
    pushSent: boolean;
    suppressed: boolean;
    reason?: string;
  }> {
    const rule = params.rule as AlertRule & { _id: unknown };
    const ruleId = this.toObjectIdString(rule);
    const latestEvent = await this.findLatestAlertEventForRule(
      params.flowId,
      ruleId,
      rule.nodeId,
      rule.moduleId,
      this.normalizeReadingKey(rule.readingKey)
    );
    const deliveryGate = this.evaluateAlertDeliveryGate(
      latestEvent,
      params.occurredAt,
      { moduleId: rule.moduleId, severity: rule.severity }
    );
    if (!deliveryGate.allowSend) {
      return {
        historyId: latestEvent ? this.toObjectIdString(latestEvent) : '',
        pushSent: false,
        suppressed: true,
        reason: deliveryGate.reason,
      };
    }

    const pushAction = this.extractPushAction(rule.actions);
    const pushPayload = this.extractPushPayload(pushAction?.payload);
    const title = pushPayload.title ?? this.buildDefaultRuleTitle(rule);
    const body =
      pushPayload.body ?? this.buildDefaultRuleBody(rule, params.value);

    const createdEvent = await this.alertEventModel.create({
      flowId: params.flowId,
      ruleId,
      nodeId: rule.nodeId,
      moduleId: rule.moduleId,
      readingKey: this.normalizeReadingKey(rule.readingKey),
      severity: rule.severity,
      title,
      body,
      value: params.value,
      operator: rule.operator,
      threshold: rule.threshold ?? null,
      min: rule.min ?? null,
      max: rule.max ?? null,
      occurredAt: params.occurredAt,
      notificationReceived: deliveryGate.inheritReceived,
      notificationHandled: false,
      notificationReceivedAt:
        deliveryGate.inheritReceived && latestEvent?.notificationReceivedAt
          ? latestEvent.notificationReceivedAt
          : null,
      notificationHandledAt: null,
      notificationLastSentAt: params.occurredAt,
      notificationNextReminderAt: deliveryGate.inheritReceived
        ? new Date(params.occurredAt.getTime() + this.receivedReminderMs)
        : null,
    });

    const historyId = this.toObjectIdString(createdEvent);

    const delivery = await this.sendAlertToFlowOwner({
      flowId: params.flowId,
      title,
      body,
      severity: rule.severity,
      data: {
        type: 'ALERT_TRIGGERED',
        historyId,
        ruleId,
        nodeId: rule.nodeId,
        moduleId: rule.moduleId,
        readingKey: this.normalizeReadingKey(rule.readingKey),
        value: params.value,
        operator: rule.operator,
        threshold: rule.threshold ?? '',
        min: rule.min ?? '',
        max: rule.max ?? '',
        timestamp: params.occurredAt.toISOString(),
        ...params.metadata,
      },
    });

    return {
      historyId,
      pushSent: delivery.successCount > 0,
      suppressed: false,
    };
  }

  private async getOwnedAlertEventOrThrow(
    userId: string,
    historyId: string
  ): Promise<AlertEventDocument> {
    if (!Types.ObjectId.isValid(historyId)) {
      throw new NotFoundException('Alert history event not found.');
    }

    const event = await this.alertEventModel.findById(historyId).exec();
    if (!event) {
      throw new NotFoundException('Alert history event not found.');
    }

    const ownerId = await this.getFlowOwnerId(event.flowId);
    if (!ownerId || ownerId !== userId) {
      throw new ForbiddenException(
        'You are not allowed to update this alert history event.'
      );
    }

    return event;
  }

  private mapAlertDeliveryState(
    event: Pick<
      AlertEvent,
      | 'flowId'
      | 'ruleId'
      | 'nodeId'
      | 'notificationReceived'
      | 'notificationHandled'
      | 'notificationReceivedAt'
      | 'notificationHandledAt'
    > & { _id?: unknown }
  ): AlertDeliveryState {
    return {
      historyId: this.toObjectIdString(event),
      flowId: event.flowId,
      ruleId: event.ruleId,
      nodeId: event.nodeId,
      notificationReceived: Boolean(event.notificationReceived),
      notificationHandled: Boolean(event.notificationHandled),
      notificationReceivedAt: event.notificationReceivedAt ?? null,
      notificationHandledAt: event.notificationHandledAt ?? null,
    };
  }

  private async findLatestAlertEventForRule(
    flowId: string,
    ruleId: string,
    nodeId: string,
    moduleId: string,
    readingKey: string
  ): Promise<AlertEventDocument | null> {
    return this.alertEventModel
      .findOne({
        flowId,
        ruleId,
        nodeId,
        moduleId,
        readingKey,
      })
      .sort({ occurredAt: -1, _id: -1 })
      .exec();
  }

  private evaluateAlertDeliveryGate(
    latestEvent: AlertEventDocument | null,
    occurredAt: Date,
    context?: { moduleId?: string; severity?: AlertSeverity }
  ): { allowSend: boolean; inheritReceived: boolean; reason?: string } {
    if (!latestEvent) {
      return { allowSend: true, inheritReceived: false };
    }

    if (latestEvent.notificationHandled) {
      const cooldownMs = this.resolveHandledCooldownMs(
        context?.moduleId ?? latestEvent.moduleId,
        context?.severity ?? latestEvent.severity
      );
      const handledAt =
        latestEvent.notificationHandledAt ??
        latestEvent.updatedAt ??
        latestEvent.createdAt ??
        latestEvent.occurredAt;
      const elapsedSinceHandledMs = handledAt
        ? Math.max(0, occurredAt.getTime() - handledAt.getTime())
        : cooldownMs;

      if (elapsedSinceHandledMs < cooldownMs) {
        return {
          allowSend: false,
          inheritReceived: true,
          reason:
            'Alert notification already handled by user and still within handled cooldown window.',
        };
      }

      return {
        allowSend: true,
        inheritReceived: false,
      };
    }

    if (!latestEvent.notificationReceived) {
      return { allowSend: true, inheritReceived: false };
    }

    const baseTime =
      latestEvent.notificationLastSentAt ??
      latestEvent.updatedAt ??
      latestEvent.createdAt ??
      latestEvent.occurredAt;

    if (baseTime) {
      const elapsedMs = occurredAt.getTime() - baseTime.getTime();
      if (elapsedMs < this.receivedReminderMs) {
        return {
          allowSend: false,
          inheritReceived: true,
          reason: 'Reminder throttled after receive acknowledgement.',
        };
      }
    }

    return {
      allowSend: true,
      inheritReceived: true,
    };
  }

  private resolveHandledCooldownMs(
    moduleId?: string,
    severity?: AlertSeverity
  ): number {
    const normalizedModuleId = moduleId?.trim() ?? '';
    const normalizedSeverity = this.normalizeSeverity(severity);

    if (normalizedModuleId && normalizedSeverity) {
      const key = this.normalizeModuleSeverityKey(
        `${normalizedModuleId}|${normalizedSeverity}`
      );
      const moduleSeverityMs = this.handledCooldownByModuleSeverityMs.get(key);
      if (moduleSeverityMs) {
        return moduleSeverityMs;
      }
    }

    if (normalizedModuleId) {
      const moduleMs = this.handledCooldownByModuleMs.get(normalizedModuleId);
      if (moduleMs) {
        return moduleMs;
      }
    }

    if (normalizedSeverity) {
      const severityMs =
        this.handledCooldownBySeverityMs.get(normalizedSeverity);
      if (severityMs) {
        return severityMs;
      }
    }

    return this.handledCooldownMs;
  }

  private readDurationMapConfig(
    name: string,
    normalizeKey: (key: string) => string
  ): Map<string, number> {
    const raw = this.configService.get<string>(name);
    if (!raw || !raw.trim()) {
      return new Map<string, number>();
    }

    const parsed = new Map<string, number>();
    const entries = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    for (const entry of entries) {
      const separatorIndex = entry.indexOf('=');
      if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
        continue;
      }

      const key = normalizeKey(entry.slice(0, separatorIndex));
      const rawValue = entry.slice(separatorIndex + 1).trim();
      const parsedValue = Number(rawValue);

      if (!key || !Number.isFinite(parsedValue) || parsedValue <= 0) {
        continue;
      }

      parsed.set(key, Math.trunc(parsedValue));
    }

    return parsed;
  }

  private readSeverityDurationMapConfig(
    name: string
  ): Map<AlertSeverity, number> {
    const rawMap = this.readDurationMapConfig(name, (key) =>
      this.normalizeSeverity(key)
    );
    const result = new Map<AlertSeverity, number>();

    for (const [key, value] of rawMap.entries()) {
      if (this.isAlertSeverity(key)) {
        result.set(key, value);
      }
    }

    return result;
  }

  private normalizeModuleSeverityKey(value: string): string {
    const [rawModuleId, rawSeverity] = value.split('|');
    const moduleId = rawModuleId?.trim() ?? '';
    const severity = this.normalizeSeverity(rawSeverity);

    if (!moduleId || !severity) {
      return '';
    }

    return `${moduleId}|${severity}`;
  }

  private normalizeSeverity(value: unknown): AlertSeverity | '' {
    if (typeof value !== 'string') {
      return '';
    }

    const normalized = value.trim().toLowerCase();
    return this.isAlertSeverity(normalized) ? normalized : '';
  }

  private isAlertSeverity(value: string): value is AlertSeverity {
    return ALERT_SEVERITIES.includes(value as AlertSeverity);
  }

  private async sendAlertToFlowOwner(input: {
    flowId: string;
    title: string;
    body: string;
    data?: Record<string, string | number | boolean>;
    severity?: AlertSeverity;
  }): Promise<{
    requestedTokens: number;
    successCount: number;
    failureCount: number;
    invalidatedTokens: number;
  }> {
    const ownerId = await this.getFlowOwnerId(input.flowId);
    if (!ownerId) {
      return {
        requestedTokens: 0,
        successCount: 0,
        failureCount: 0,
        invalidatedTokens: 0,
      };
    }

    const activeTokens = await this.notificationDeviceTokenModel
      .find({ userId: ownerId, isActive: true })
      .select({ fcmToken: 1 })
      .lean();

    const tokens = Array.from(
      new Set(
        activeTokens
          .map((entry) => entry.fcmToken)
          .filter((token): token is string => Boolean(token))
      )
    );

    if (!tokens.length) {
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
        android: {
          priority: 'high',
          notification: { sound: 'default' },
        },
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
          flowId: input.flowId,
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

  private async assertUserCanAccessFlow(
    userId: string,
    flowId: string
  ): Promise<Pick<Flow, 'userId' | 'nodes'>> {
    if (!Types.ObjectId.isValid(flowId)) {
      throw new ForbiddenException(
        'You are not allowed to access this flow alerts.'
      );
    }

    const flow = await this.flowModel
      .findOne({ _id: flowId, userId })
      .select({ userId: 1, nodes: 1 })
      .lean()
      .exec();
    if (!flow) {
      throw new ForbiddenException(
        'You are not allowed to access this flow alerts.'
      );
    }

    return flow;
  }

  private assertNodeBelongsToFlow(
    flow: Pick<Flow, 'nodes'>,
    nodeId: string,
    moduleId: string
  ): void {
    const normalizedNodeId = nodeId.trim();
    const normalizedModuleId = moduleId.trim();
    const node = (flow.nodes ?? []).find(
      (entry) => entry.id === normalizedNodeId
    );
    if (!node) {
      throw new BadRequestException(
        'nodeId does not exist in the provided flow.'
      );
    }
    const nodeModuleId = String(node.data?.moduleId ?? '').trim();
    if (nodeModuleId !== normalizedModuleId) {
      throw new BadRequestException(
        'moduleId does not match the node module in this flow.'
      );
    }
  }

  private assertReadingKeyAllowed(moduleId: string, readingKey: string): void {
    const normalizedModuleId = moduleId.trim();
    const normalizedReadingKey = this.normalizeReadingKey(readingKey);
    const supported = MODULE_READING_KEYS[normalizedModuleId];

    if (!supported || !supported.includes(normalizedReadingKey)) {
      throw new BadRequestException(
        `readingKey "${readingKey}" is not supported for moduleId "${moduleId}".`
      );
    }
  }

  private validateRuleCondition(input: {
    operator: AlertRuleOperator;
    threshold?: number | null;
    min?: number | null;
    max?: number | null;
  }): void {
    const operator = input.operator;
    if (!ALL_OPERATORS.has(operator)) {
      throw new BadRequestException(`Unsupported operator "${operator}".`);
    }

    if (SIMPLE_OPERATORS.includes(operator)) {
      if (input.threshold === null || input.threshold === undefined) {
        throw new BadRequestException(
          `Operator "${operator}" requires "threshold".`
        );
      }
      if (
        typeof input.threshold !== 'number' ||
        !Number.isFinite(input.threshold)
      ) {
        throw new BadRequestException('"threshold" must be a finite number.');
      }
      if (input.min !== null && input.min !== undefined) {
        throw new BadRequestException(
          `"min" must be null for operator "${operator}".`
        );
      }
      if (input.max !== null && input.max !== undefined) {
        throw new BadRequestException(
          `"max" must be null for operator "${operator}".`
        );
      }
      return;
    }

    if (input.threshold !== null && input.threshold !== undefined) {
      throw new BadRequestException(
        `Operator "${operator}" requires "threshold" to be null.`
      );
    }
    if (input.min === null || input.min === undefined) {
      throw new BadRequestException(`Operator "${operator}" requires "min".`);
    }
    if (input.max === null || input.max === undefined) {
      throw new BadRequestException(`Operator "${operator}" requires "max".`);
    }
    if (!Number.isFinite(input.min) || !Number.isFinite(input.max)) {
      throw new BadRequestException('"min" and "max" must be finite numbers.');
    }
    if (input.min >= input.max) {
      throw new BadRequestException('"min" must be strictly less than "max".');
    }
  }

  private matchesOperator(input: {
    operator: AlertRuleOperator;
    value: number;
    threshold: number | null;
    min: number | null;
    max: number | null;
  }): boolean {
    switch (input.operator) {
      case '>':
        return input.threshold !== null && input.value > input.threshold;
      case '<':
        return input.threshold !== null && input.value < input.threshold;
      case '>=':
        return input.threshold !== null && input.value >= input.threshold;
      case '<=':
        return input.threshold !== null && input.value <= input.threshold;
      case '=':
        return input.threshold !== null && input.value === input.threshold;
      case 'between':
        return (
          input.min !== null &&
          input.max !== null &&
          input.value >= input.min &&
          input.value <= input.max
        );
      case 'outside':
        return (
          input.min !== null &&
          input.max !== null &&
          (input.value < input.min || input.value > input.max)
        );
      default:
        return false;
    }
  }

  private async findPolicyForRule(
    moduleId: string,
    readingKey: string
  ): Promise<AlertPolicyDocument | null> {
    return this.alertPolicyModel
      .findOne({
        moduleId: moduleId.trim(),
        readingKey: this.normalizeReadingKey(readingKey),
        isActive: true,
      })
      .exec();
  }

  private mapRule(rule: Partial<AlertRule> & { _id?: unknown }): RuleOutput {
    return {
      id: this.toObjectIdString(rule),
      flowId: String(rule.flowId ?? ''),
      nodeId: String(rule.nodeId ?? ''),
      moduleId: String(rule.moduleId ?? ''),
      readingKey: String(rule.readingKey ?? ''),
      operator: (rule.operator as AlertRuleOperator) ?? '>',
      threshold:
        typeof rule.threshold === 'number'
          ? rule.threshold
          : (rule.threshold ?? null),
      min: typeof rule.min === 'number' ? rule.min : (rule.min ?? null),
      max: typeof rule.max === 'number' ? rule.max : (rule.max ?? null),
      severity: (rule.severity as AlertSeverity) ?? 'warning',
      enabled: Boolean(rule.enabled),
      actions: Array.isArray(rule.actions) ? rule.actions : [],
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    };
  }

  private normalizeRuleActions(actions?: unknown): Array<{
    type: 'send_push';
    payload?: Record<string, unknown>;
  }> {
    if (!Array.isArray(actions)) {
      return [];
    }

    return actions
      .filter(
        (action) =>
          action &&
          typeof action === 'object' &&
          (action as { type?: string }).type === 'send_push'
      )
      .map((action) => ({
        type: 'send_push' as const,
        payload:
          action && typeof action === 'object'
            ? ((action as { payload?: unknown }).payload as
                | Record<string, unknown>
                | undefined)
            : undefined,
      }));
  }

  private normalizeReadingKey(readingKey: string): string {
    return readingKey.trim().toLowerCase();
  }

  private normalizeChannels(channels?: string[]): string[] {
    if (!Array.isArray(channels) || !channels.length) {
      return ['push'];
    }
    const normalized = Array.from(
      new Set(
        channels
          .map((channel) => String(channel).trim().toLowerCase())
          .filter(Boolean)
      )
    );
    return normalized.length ? normalized : ['push'];
  }

  private normalizeSupportedOperators(
    operators: unknown
  ): AlertComparisonOperator[] {
    if (!Array.isArray(operators)) {
      return ['>', '<', '>=', '<=', '='];
    }

    const normalized = Array.from(
      new Set(
        operators
          .map((operator) =>
            typeof operator === 'string' ? operator.trim() : ''
          )
          .filter(
            (operator): operator is AlertComparisonOperator =>
              operator === '>' ||
              operator === '<' ||
              operator === '>=' ||
              operator === '<=' ||
              operator === '=' ||
              operator === 'between' ||
              operator === 'outside'
          )
      )
    );
    return normalized.length ? normalized : ['>', '<', '>=', '<=', '='];
  }

  private deduplicatePolicies(
    policies: UpsertAlertPoliciesDto['policies']
  ): UpsertAlertPoliciesDto['policies'] {
    const deduped = new Map<
      string,
      UpsertAlertPoliciesDto['policies'][number]
    >();
    for (const policy of policies) {
      if (!policy?.moduleId || !policy?.readingKey) {
        continue;
      }
      const key = `${policy.moduleId.trim()}::${this.normalizeReadingKey(
        policy.readingKey
      )}`;
      deduped.set(key, {
        ...policy,
        moduleId: policy.moduleId.trim(),
        readingKey: this.normalizeReadingKey(policy.readingKey),
        label: policy.label.trim(),
        supportedOperators: this.normalizeSupportedOperators(
          policy.supportedOperators
        ),
        defaultOperator: (policy.defaultOperator as AlertRuleOperator) ?? '>',
        defaultThreshold: this.normalizeNullableNumber(policy.defaultThreshold),
        defaultMin: this.normalizeNullableNumber(policy.defaultMin),
        defaultMax: this.normalizeNullableNumber(policy.defaultMax),
      });
    }
    const normalizedPolicies = Array.from(deduped.values());
    normalizedPolicies.forEach((policy) =>
      this.validatePolicyDefaultCondition(policy)
    );
    return normalizedPolicies;
  }

  private pickDefaultOperator(supportedOperators: unknown): AlertRuleOperator {
    const normalized = this.normalizeSupportedOperators(supportedOperators);
    const preferredSimple = normalized.find((operator) =>
      SIMPLE_OPERATORS.includes(operator)
    );
    return (preferredSimple ?? normalized[0] ?? '>') as AlertRuleOperator;
  }

  private mapPolicy(
    policy: Partial<AlertPolicy> & { _id?: unknown }
  ): PolicyOutput {
    const supportedOperators = this.normalizeSupportedOperators(
      policy.supportedOperators
    );
    const fallbackOperator = this.pickDefaultOperator(supportedOperators);
    const defaultOperator = this.normalizeDefaultOperator(
      policy.defaultOperator,
      supportedOperators,
      fallbackOperator
    );

    const defaults = this.normalizeConditionByOperator({
      operator: defaultOperator,
      threshold: this.normalizeNullableNumber(policy.defaultThreshold),
      min: this.normalizeNullableNumber(policy.defaultMin),
      max: this.normalizeNullableNumber(policy.defaultMax),
    });

    return {
      id: this.toObjectIdString(policy),
      moduleId: String(policy.moduleId ?? ''),
      readingKey: String(policy.readingKey ?? ''),
      label: String(policy.label ?? ''),
      required: Boolean(policy.required),
      thresholdRequired: Boolean(policy.thresholdRequired),
      defaultEnabled: Boolean(policy.defaultEnabled),
      defaultSeverity: (policy.defaultSeverity as AlertSeverity) ?? 'warning',
      defaultOperator,
      defaultThreshold: defaults.threshold,
      defaultMin: defaults.min,
      defaultMax: defaults.max,
      supportedOperators,
      isActive: Boolean(policy.isActive),
    };
  }

  private validatePolicyDefaultCondition(
    policy: UpsertAlertPoliciesDto['policies'][number]
  ): void {
    const supportedOperators = this.normalizeSupportedOperators(
      policy.supportedOperators
    );
    const normalizedDefaultOperator = String(
      policy.defaultOperator ?? ''
    ).trim();
    if (
      !ALL_OPERATORS.has(normalizedDefaultOperator as AlertRuleOperator) ||
      !supportedOperators.includes(
        normalizedDefaultOperator as AlertComparisonOperator
      )
    ) {
      throw new BadRequestException(
        `defaultOperator "${policy.defaultOperator}" must be one of supportedOperators for ${policy.moduleId}:${policy.readingKey}.`
      );
    }

    this.validateRuleCondition({
      operator: normalizedDefaultOperator as AlertRuleOperator,
      threshold: this.normalizeNullableNumber(policy.defaultThreshold),
      min: this.normalizeNullableNumber(policy.defaultMin),
      max: this.normalizeNullableNumber(policy.defaultMax),
    });
  }

  private resolvePolicyDefaults(policy: Partial<AlertPolicy>): {
    operator: AlertRuleOperator;
    threshold: number | null;
    min: number | null;
    max: number | null;
    isValidCondition: boolean;
  } {
    const supportedOperators = this.normalizeSupportedOperators(
      policy.supportedOperators
    );
    const fallbackOperator = this.pickDefaultOperator(supportedOperators);
    const operator = this.normalizeDefaultOperator(
      policy.defaultOperator,
      supportedOperators,
      fallbackOperator
    );
    const normalizedCondition = this.normalizeConditionByOperator({
      operator,
      threshold: this.normalizeNullableNumber(policy.defaultThreshold),
      min: this.normalizeNullableNumber(policy.defaultMin),
      max: this.normalizeNullableNumber(policy.defaultMax),
    });

    const isValidCondition =
      SIMPLE_OPERATORS.includes(operator) &&
      normalizedCondition.threshold !== null
        ? true
        : RANGE_OPERATORS.includes(operator) &&
          normalizedCondition.min !== null &&
          normalizedCondition.max !== null &&
          normalizedCondition.min < normalizedCondition.max;

    return {
      operator,
      threshold: normalizedCondition.threshold,
      min: normalizedCondition.min,
      max: normalizedCondition.max,
      isValidCondition,
    };
  }

  private normalizeDefaultOperator(
    operator: unknown,
    supportedOperators: AlertComparisonOperator[],
    fallback: AlertRuleOperator
  ): AlertRuleOperator {
    if (typeof operator !== 'string') {
      return fallback;
    }
    const normalized = operator.trim() as AlertRuleOperator;
    if (
      ALL_OPERATORS.has(normalized) &&
      supportedOperators.includes(normalized as AlertComparisonOperator)
    ) {
      return normalized;
    }
    return fallback;
  }

  private normalizeConditionByOperator(input: {
    operator: AlertRuleOperator;
    threshold: number | null;
    min: number | null;
    max: number | null;
  }): { threshold: number | null; min: number | null; max: number | null } {
    if (SIMPLE_OPERATORS.includes(input.operator)) {
      return {
        threshold: input.threshold,
        min: null,
        max: null,
      };
    }

    return {
      threshold: null,
      min: input.min,
      max: input.max,
    };
  }

  private normalizeNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  private resolvePreferenceEnabled(
    preference: Pick<NotificationPreference, 'notificationsEnabled'> | null
  ): boolean {
    // Missing preference document means opt-in by default.
    return preference ? preference.notificationsEnabled : true;
  }

  private buildPreferenceFilter(
    flowId: string,
    userId: string
  ): FilterQuery<NotificationPreferenceDocument> {
    return {
      userId,
      $or: [{ flowId }, { projectId: flowId }],
    };
  }

  private async getFlowOwnerId(flowId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(flowId)) {
      return null;
    }

    const flow = await this.flowModel
      .findById(flowId)
      .select({ userId: 1 })
      .lean<{ userId?: Types.ObjectId | string }>()
      .exec();

    if (flow?.userId instanceof Types.ObjectId) {
      return flow.userId.toHexString();
    }
    if (typeof flow?.userId === 'string' && flow.userId.trim()) {
      return flow.userId;
    }
    return null;
  }

  private async buildCursorFilterClause(
    flowId: string,
    cursor: string | undefined,
    baseFilter: FilterQuery<AlertEventDocument>
  ): Promise<FilterQuery<AlertEventDocument> | null> {
    if (!cursor || !Types.ObjectId.isValid(cursor)) {
      return null;
    }

    const cursorId = new Types.ObjectId(cursor);
    const cursorEvent = await this.alertEventModel
      .findOne({
        _id: cursorId,
        flowId,
      })
      .select({ occurredAt: 1 })
      .lean()
      .exec();
    if (!cursorEvent) {
      return null;
    }

    return {
      $or: [
        { occurredAt: { $lt: cursorEvent.occurredAt } },
        { occurredAt: cursorEvent.occurredAt, _id: { $lt: cursorId } },
      ],
      ...(baseFilter.nodeId ? { nodeId: baseFilter.nodeId } : {}),
      ...(baseFilter.severity ? { severity: baseFilter.severity } : {}),
    };
  }

  private extractPushAction(
    actions: unknown
  ): { type: 'send_push'; payload?: unknown } | null {
    if (!Array.isArray(actions)) {
      return null;
    }

    const action = actions.find(
      (candidate) =>
        candidate &&
        typeof candidate === 'object' &&
        (candidate as { type?: string }).type === 'send_push'
    ) as unknown;

    if (!action || typeof action !== 'object') {
      return null;
    }

    return action as { type: 'send_push'; payload?: unknown };
  }

  private toObjectIdString(value: { _id?: unknown }): string {
    const rawId = value._id;
    if (typeof rawId === 'string') {
      return rawId;
    }
    if (rawId instanceof Types.ObjectId) {
      return rawId.toHexString();
    }
    if (rawId && typeof rawId === 'object') {
      const candidate = rawId as { toString?: () => string };
      if (typeof candidate.toString === 'function') {
        const converted = candidate.toString();
        if (converted && converted !== '[object Object]') {
          return converted;
        }
      }
    }
    throw new InternalServerErrorException(
      'Document id is missing or invalid.'
    );
  }

  private extractPushPayload(payload: unknown): {
    title?: string;
    body?: string;
  } {
    if (!payload || typeof payload !== 'object') {
      return {};
    }
    const candidate = payload as Partial<{ title: string; body: string }>;
    return {
      title: typeof candidate.title === 'string' ? candidate.title : undefined,
      body: typeof candidate.body === 'string' ? candidate.body : undefined,
    };
  }

  private buildDefaultRuleTitle(rule: AlertRule): string {
    const label = `${rule.moduleId} ${rule.readingKey}`.trim();
    if (rule.severity === 'critical') return `${label} Critical Alert`;
    if (rule.severity === 'warning') return `${label} Warning`;
    return `${label} Notification`;
  }

  private buildDefaultRuleBody(rule: AlertRule, value: number): string {
    if (RANGE_OPERATORS.includes(rule.operator)) {
      return `${rule.moduleId} ${rule.readingKey} value ${value} matched ${rule.operator} range (${rule.min}..${rule.max}).`;
    }
    return `${rule.moduleId} ${rule.readingKey} value ${value} crossed threshold ${rule.threshold}.`;
  }

  private getMessagingClient(): Messaging {
    if (this.messagingClient) {
      return this.messagingClient;
    }

    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
    const rawPrivateKey = this.configService.get<string>(
      'FIREBASE_PRIVATE_KEY'
    );
    const privateKey = rawPrivateKey?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      throw new InternalServerErrorException(
        'Firebase credentials are missing. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.'
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
        appName
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
    data: Record<string, string | number | boolean | undefined>
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
    accumulator: string[]
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
    errorCode: string
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
      }
    );
  }

  private shouldTriggerRule(
    cooldownKey: string,
    moduleId: string,
    occurredAt?: Date
  ): boolean {
    const now = occurredAt?.getTime() ?? Date.now();
    if (moduleId.trim() === GAS_SENSOR_MODULE_ID) {
      return this.shouldTriggerGasRule(cooldownKey, now);
    }

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

  private shouldTriggerGasRule(cooldownKey: string, now: number): boolean {
    const state = this.gasRuleBackoffState.get(cooldownKey);
    if (!state) {
      this.gasRuleBackoffState.set(cooldownKey, {
        lastTriggeredAtMs: now,
        nextDelayMs: this.ruleCooldownMs,
      });
      if (this.gasRuleBackoffState.size > 5000) {
        this.pruneGasRuleBackoffState(now);
      }
      return true;
    }

    if (now - state.lastTriggeredAtMs < state.nextDelayMs) {
      return false;
    }

    this.gasRuleBackoffState.set(cooldownKey, {
      lastTriggeredAtMs: now,
      nextDelayMs: Math.min(state.nextDelayMs * 2, this.gasRuleMaxBackoffMs),
    });
    if (this.gasRuleBackoffState.size > 5000) {
      this.pruneGasRuleBackoffState(now);
    }

    return true;
  }

  private resetRuleTriggerState(cooldownKey: string, moduleId: string): void {
    if (moduleId.trim() === GAS_SENSOR_MODULE_ID) {
      this.gasRuleBackoffState.delete(cooldownKey);
      return;
    }
    this.recentRuleTriggers.delete(cooldownKey);
  }

  private pruneRecentRuleTriggers(now: number): void {
    const expiry = now - this.ruleCooldownMs;
    for (const [key, value] of this.recentRuleTriggers.entries()) {
      if (value <= expiry) {
        this.recentRuleTriggers.delete(key);
      }
    }
  }

  private pruneGasRuleBackoffState(now: number): void {
    const expiry = now - this.gasRuleMaxBackoffMs;
    for (const [key, value] of this.gasRuleBackoffState.entries()) {
      if (value.lastTriggeredAtMs <= expiry) {
        this.gasRuleBackoffState.delete(key);
      }
    }
  }

  private readPositiveConfigNumber(name: string, fallback: number): number {
    const raw = this.configService.get<string | number>(name);
    if (raw === undefined || raw === null || raw === '') return fallback;

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.trunc(parsed);
  }

  async hasAlertRulesForFlow(flowId: string, userId: string): Promise<boolean> {
    const count = await this.alertRuleModel
      .countDocuments({ flowId, userId })
      .exec();
    return count > 0;
  }

  async getAlertRulesCounts(
    userId: string,
    flowIds: string[]
  ): Promise<Map<string, boolean>> {
    const normalizedFlowIds = Array.from(
      new Set(flowIds.map((id) => id.trim()).filter((id) => id.length > 0))
    );

    if (!normalizedFlowIds.length) {
      return new Map<string, boolean>();
    }

    // Aggregate to get flows that have at least one alert rule
    const flowsWithRules = await this.alertRuleModel
      .distinct('flowId', {
        userId,
        flowId: { $in: normalizedFlowIds },
      })
      .exec();

    const result = new Map<string, boolean>();
    for (const flowId of normalizedFlowIds) {
      result.set(flowId, flowsWithRules.includes(flowId));
    }

    return result;
  }
}
