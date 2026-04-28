import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AlertRuleDocument = AlertRule & Document;

@Schema({ _id: false })
export class AlertRuleAction {
  @Prop({ required: true, enum: ['device_action', 'send_push'] })
  type!: 'device_action' | 'send_push';

  @Prop()
  topic?: string;

  @Prop()
  templateId?: string;

  @Prop({ type: Object })
  payload?: Record<string, unknown>;
}

const AlertRuleActionSchema = SchemaFactory.createForClass(AlertRuleAction);

@Schema({ collection: 'alert_rules', timestamps: true })
export class AlertRule {
  @Prop({ required: true, index: true })
  projectId!: string;

  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true, index: true })
  sensorType!: string;

  @Prop({ required: true, enum: ['>', '<', '>=', '<=', '==', '!='] })
  operator!: '>' | '<' | '>=' | '<=' | '==' | '!=';

  @Prop({ required: true })
  threshold!: number;

  @Prop({ required: true, default: true, index: true })
  enabled!: boolean;

  @Prop({ required: true, enum: ['critical', 'warning', 'info'] })
  severity!: 'critical' | 'warning' | 'info';

  @Prop({ type: [AlertRuleActionSchema], default: [] })
  actions!: AlertRuleAction[];

  createdAt?: Date;
  updatedAt?: Date;
}

export const AlertRuleSchema = SchemaFactory.createForClass(AlertRule);

AlertRuleSchema.index({ projectId: 1, enabled: 1 });
AlertRuleSchema.index({ projectId: 1, sensorType: 1 });
