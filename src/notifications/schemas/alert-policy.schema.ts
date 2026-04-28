import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AlertPolicyDocument = HydratedDocument<AlertPolicy>;

@Schema({ collection: 'alert_policies', timestamps: true })
export class AlertPolicy {
  @Prop({ required: true })
  moduleId!: string;

  @Prop({ required: true })
  readingKey!: string;

  @Prop({ required: true })
  label!: string;

  @Prop({ required: true, default: false })
  required!: boolean;

  @Prop({ required: true, default: false })
  thresholdRequired!: boolean;

  @Prop({ required: true, default: true })
  defaultEnabled!: boolean;

  @Prop({ required: true, enum: ['critical', 'warning', 'info'] })
  defaultSeverity!: 'critical' | 'warning' | 'info';

  @Prop({ type: [String], default: ['>', '<', '>=', '<='] })
  supportedOperators!: Array<'>' | '<' | '>=' | '<=' | 'between' | 'outside'>;

  @Prop({ required: true, default: true, index: true })
  isActive!: boolean;
}

export const AlertPolicySchema = SchemaFactory.createForClass(AlertPolicy);

AlertPolicySchema.index({ moduleId: 1, readingKey: 1 }, { unique: true });
