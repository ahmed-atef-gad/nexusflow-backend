import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type IncidentDocument = HydratedDocument<Incident>;

@Schema({ collection: 'incidents', timestamps: true })
export class Incident {
  @Prop({ required: true, index: true })
  user_id!: string;

  @Prop({ required: true, index: true })
  flow_id!: string;

  @Prop({ required: true, index: true })
  device_id!: string;

  @Prop({ required: true, index: true })
  rule_id!: string;

  @Prop({ required: true, index: true })
  node_id!: string;

  @Prop({ required: true, index: true })
  module_id!: string;

  @Prop({ required: true, index: true })
  reading_key!: string;

  @Prop({ required: true, index: true })
  opened_at!: Date;

  @Prop({ type: Date, default: null, index: true })
  closed_at?: Date | null;

  @Prop({ type: Date, default: null, index: true })
  user_acknowledged_at?: Date | null;

  @Prop({ type: Date, default: null, index: true })
  last_notification_sent_at?: Date | null;

  @Prop({ type: Number, default: 0 })
  notification_count!: number;

  @Prop({ required: true, enum: ['critical', 'warning', 'info'], index: true })
  severity!: 'critical' | 'warning' | 'info';

  createdAt?: Date;
  updatedAt?: Date;
}

export const IncidentSchema = SchemaFactory.createForClass(Incident);

IncidentSchema.index(
  {
    user_id: 1,
    flow_id: 1,
    rule_id: 1,
    device_id: 1,
    closed_at: 1,
    opened_at: -1,
  },
  { name: 'incident_lookup' }
);
IncidentSchema.index(
  { user_id: 1, opened_at: -1, _id: -1 },
  { name: 'incident_history' }
);
