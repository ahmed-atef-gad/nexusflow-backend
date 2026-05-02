import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

@Schema({ collection: 'notifications', timestamps: true })
export class Notification {
  @Prop({ required: true, index: true })
  user_id!: string;

  @Prop({ required: true, index: true })
  incident_id!: string;

  @Prop({ required: true, index: true })
  device_id!: string;

  @Prop({ required: true, index: true })
  rule_id!: string;

  @Prop({ required: true, enum: ['critical', 'warning', 'info'], index: true })
  severity!: 'critical' | 'warning' | 'info';

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  body!: string;

  @Prop({ type: Object, default: {} })
  data!: Record<string, string>;

  @Prop({ type: Date, required: true, index: true })
  sent_at!: Date;

  @Prop({ type: Date, default: null, index: true })
  received_at?: Date | null;

  @Prop({ type: Date, default: null, index: true })
  handled_at?: Date | null;

  @Prop({
    required: true,
    enum: ['alert', 'resolved'],
    default: 'alert',
    index: true,
  })
  type!: 'alert' | 'resolved';

  createdAt?: Date;
  updatedAt?: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index(
  { user_id: 1, sent_at: -1, _id: -1 },
  { name: 'notification_history' }
);
NotificationSchema.index(
  { incident_id: 1, sent_at: -1 },
  { name: 'incident_notifications' }
);
