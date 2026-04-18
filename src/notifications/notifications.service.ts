import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { App, cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import {
  BatchResponse,
  getMessaging,
  Messaging,
  MulticastMessage,
} from 'firebase-admin/messaging';
import { RegisterNotificationDeviceDto } from './dto/register-notification-device.dto';
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
}
