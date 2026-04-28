import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type NotificationPreferenceDocument =
  HydratedDocument<NotificationPreference>;

@Schema({ _id: false })
export class SensorNotificationPreference {
  @Prop({ required: true })
  sensorType!: string;

  @Prop({ required: true, default: true })
  enabled!: boolean;

  @Prop()
  threshold?: number;
}

const SensorNotificationPreferenceSchema = SchemaFactory.createForClass(
  SensorNotificationPreference
);

@Schema({ collection: 'notification_preferences', timestamps: true })
export class NotificationPreference {
  @Prop({ required: true, index: true })
  projectId!: string;

  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ type: [SensorNotificationPreferenceSchema], default: [] })
  sensors!: SensorNotificationPreference[];
}

export const NotificationPreferenceSchema = SchemaFactory.createForClass(
  NotificationPreference
);

NotificationPreferenceSchema.index(
  { projectId: 1, userId: 1 },
  { unique: true }
);
