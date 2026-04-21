import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type NotificationDeviceTokenDocument = NotificationDeviceToken & Document;

@Schema({ collection: 'device_tokens', timestamps: true })
export class NotificationDeviceToken {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, index: true })
  projectId: string;

  @Prop({ required: true, index: true })
  deviceId: string;

  @Prop({ required: true, enum: ['android', 'ios'] })
  platform: 'android' | 'ios';

  @Prop({ required: true, unique: true, index: true })
  fcmToken: string;

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop()
  lastError?: string;

  @Prop()
  invalidatedAt?: Date;

  @Prop({ required: true, default: Date.now })
  lastSeenAt: Date;

  @Prop()
  appVersion?: string;

  @Prop()
  locale?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const NotificationDeviceTokenSchema = SchemaFactory.createForClass(
  NotificationDeviceToken,
);

NotificationDeviceTokenSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
NotificationDeviceTokenSchema.index({ projectId: 1, isActive: 1 });
