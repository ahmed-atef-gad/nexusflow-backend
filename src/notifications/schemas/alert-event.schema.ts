import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AlertEventDocument = AlertEvent & Document;

@Schema({ collection: 'alert_events', timestamps: true })
export class AlertEvent {
  @Prop({ required: true, index: true })
  projectId: string;

  @Prop({ required: true, index: true })
  sensorType: string;

  @Prop({ required: true, enum: ['critical', 'warning', 'info'], index: true })
  severity: 'critical' | 'warning' | 'info';

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  body: string;

  @Prop()
  value?: number;

  @Prop()
  threshold?: number;

  @Prop({ index: true })
  ruleId?: string;

  @Prop({ required: true, index: true })
  occurredAt: Date;
}

export const AlertEventSchema = SchemaFactory.createForClass(AlertEvent);

AlertEventSchema.index({ projectId: 1, occurredAt: -1 });
