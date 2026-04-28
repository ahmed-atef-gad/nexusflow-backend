import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AlertRuleDocument = AlertRule & Document;

@Schema({ _id: false })
export class AlertRuleAction {
  @Prop({ required: true, enum: ['send_push'] })
  type!: 'send_push';

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
  flowId!: string;

  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true, index: true })
  nodeId!: string;

  @Prop({ required: true, index: true })
  moduleId!: string;

  @Prop({ required: true, index: true })
  readingKey!: string;

  @Prop({
    required: true,
    enum: ['>', '<', '>=', '<=', '=', 'between', 'outside'],
  })
  operator!: '>' | '<' | '>=' | '<=' | '=' | 'between' | 'outside';

  @Prop({ type: Number, default: null })
  threshold?: number | null;

  @Prop({ type: Number, default: null })
  min?: number | null;

  @Prop({ type: Number, default: null })
  max?: number | null;

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

AlertRuleSchema.index({ flowId: 1, enabled: 1 });
AlertRuleSchema.index(
  { flowId: 1, nodeId: 1, readingKey: 1 },
  { unique: true }
);
