import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type NotificationPreferenceDocument = NotificationPreference & Document;

@Schema({ _id: false })
export class SensorNotificationPreference {
  @Prop({ required: true })
  sensorType: string;

  @Prop({ required: true, default: true })
  enabled: boolean;

  @Prop()
  threshold?: number;
}

const SensorNotificationPreferenceSchema = SchemaFactory.createForClass(
  SensorNotificationPreference,
);

@Schema({ collection: 'notification_preferences', timestamps: true })
export class NotificationPreference {
  @Prop({ required: true, index: true })
  projectId: string;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ type: [SensorNotificationPreferenceSchema], default: [] })
  sensors: SensorNotificationPreference[];
}

export const NotificationPreferenceSchema =
  SchemaFactory.createForClass(NotificationPreference);

NotificationPreferenceSchema.index({ projectId: 1, userId: 1 }, { unique: true });
