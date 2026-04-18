import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RegisterNotificationDeviceDto } from './dto/register-notification-device.dto';
import {
  NotificationDeviceToken,
  NotificationDeviceTokenDocument,
} from './schemas/notification-device-token.schema';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(NotificationDeviceToken.name)
    private readonly notificationDeviceTokenModel: Model<NotificationDeviceTokenDocument>,
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
}
