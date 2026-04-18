import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AlertPolicyDocument = AlertPolicy & Document;

@Schema({ collection: 'alert_policies', timestamps: true })
export class AlertPolicy {
  @Prop({ required: true, index: true })
  projectId: string;

  @Prop({ required: true })
  sensorType: string;

  @Prop({ required: true, default: false })
  required: boolean;

  @Prop({ required: true, default: false })
  thresholdRequired: boolean;

  @Prop({ required: true, default: true })
  defaultEnabled: boolean;

  @Prop({ required: true, enum: ['critical', 'warning', 'info'] })
  defaultSeverity: 'critical' | 'warning' | 'info';

  @Prop({ required: true, default: true, index: true })
  isActive: boolean;
}

export const AlertPolicySchema = SchemaFactory.createForClass(AlertPolicy);

AlertPolicySchema.index({ projectId: 1, sensorType: 1 }, { unique: true });
