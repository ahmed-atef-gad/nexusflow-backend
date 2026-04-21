import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
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
  NotificationPreference,
  NotificationPreferenceDocument,
} from './schemas/notification-preference.schema';
import { AlertRule, AlertRuleDocument } from './schemas/alert-rule.schema';
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

  constructor(
    @InjectModel(NotificationDeviceToken.name)
    private readonly notificationDeviceTokenModel: Model<NotificationDeviceTokenDocument>,
    @InjectModel(AlertEvent.name)
    private readonly alertEventModel: Model<AlertEventDocument>,
    @InjectModel(NotificationPreference.name)
    private readonly notificationPreferenceModel: Model<NotificationPreferenceDocument>,
    @InjectModel(AlertRule.name)
    private readonly alertRuleModel: Model<AlertRuleDocument>,
    private readonly configService: ConfigService,
  ) {}

  async registerDeviceToken(
    userId: string,
    dto: RegisterNotificationDeviceDto,
  ): Promise<{
    id: string;
    projectId: string;
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
          projectId: dto.projectId,
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
      projectId: document.projectId,
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

  async sendAlertToProject(input: SendProjectAlertInput): Promise<{
    requestedTokens: number;
    successCount: number;
    failureCount: number;
    invalidatedTokens: number;
  }> {
    const activeTokens = await this.notificationDeviceTokenModel
      .find({ projectId: input.projectId, isActive: true })
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

  private async assertUserCanAccessProject(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const [hasDeviceToken, hasPreference, hasRule] = await Promise.all([
      this.notificationDeviceTokenModel.exists({ userId, projectId }),
      this.notificationPreferenceModel.exists({ userId, projectId }),
      this.alertRuleModel.exists({ userId, projectId }),
    ]);

    if (!hasDeviceToken && !hasPreference && !hasRule) {
      throw new ForbiddenException(
        'You are not allowed to access this project alert history.',
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
}
