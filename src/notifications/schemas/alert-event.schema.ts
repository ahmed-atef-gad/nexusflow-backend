import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AlertEventDocument = HydratedDocument<AlertEvent>;

@Schema({ collection: 'alert_events', timestamps: true })
export class AlertEvent {
  @Prop({ required: true, index: true })
  flowId!: string;

  @Prop({ required: true, index: true })
  ruleId!: string;

  @Prop({ required: true, index: true })
  nodeId!: string;

  @Prop({ required: true, index: true })
  moduleId!: string;

  @Prop({ required: true, index: true })
  readingKey!: string;

  @Prop({ required: true, enum: ['critical', 'warning', 'info'], index: true })
  severity!: 'critical' | 'warning' | 'info';

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  body!: string;

  @Prop({ type: Number })
  value?: number;

  @Prop({ required: true })
  operator!: '>' | '<' | '>=' | '<=' | '=' | 'between' | 'outside';

  @Prop({ type: Number, default: null })
  threshold?: number | null;

  @Prop({ type: Number, default: null })
  min?: number | null;

  @Prop({ type: Number, default: null })
  max?: number | null;

  @Prop({ required: true, index: true })
  occurredAt!: Date;

  @Prop({ type: Boolean, default: false, index: true })
  notificationReceived!: boolean;

  @Prop({ type: Boolean, default: false, index: true })
  notificationHandled!: boolean;

  @Prop({ type: Date, default: null })
  notificationReceivedAt?: Date | null;

  @Prop({ type: Date, default: null })
  notificationHandledAt?: Date | null;

  @Prop({ type: Date, default: null })
  notificationLastSentAt?: Date | null;

  @Prop({ type: Date, default: null })
  notificationNextReminderAt?: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const AlertEventSchema = SchemaFactory.createForClass(AlertEvent);

AlertEventSchema.index({ flowId: 1, occurredAt: -1 });
AlertEventSchema.index({ flowId: 1, nodeId: 1, occurredAt: -1 });
AlertEventSchema.index({ flowId: 1, ruleId: 1, nodeId: 1, occurredAt: -1 });
