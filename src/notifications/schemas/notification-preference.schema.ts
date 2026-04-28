import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type NotificationPreferenceDocument =
  HydratedDocument<NotificationPreference>;

@Schema({ collection: 'notification_preferences', timestamps: true })
export class NotificationPreference {
  @Prop({ required: true, index: true })
  flowId!: string;

  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true, default: true })
  notificationsEnabled!: boolean;

  @Prop({ type: [String], default: ['push'] })
  channels!: string[];
}

export const NotificationPreferenceSchema = SchemaFactory.createForClass(
  NotificationPreference
);

NotificationPreferenceSchema.index({ flowId: 1, userId: 1 }, { unique: true });
