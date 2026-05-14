import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MqttPerformanceSessionDocument =
  HydratedDocument<MqttPerformanceSessionRecord>;

@Schema({ collection: 'mqtt_performance_sessions', timestamps: true })
export class MqttPerformanceSessionRecord {
  @Prop({ required: true, unique: true, index: true })
  sessionId!: string;

  @Prop({ required: true, index: true })
  clientId!: string;

  @Prop({ required: true, index: true })
  deviceMac!: string;

  @Prop({ type: String, default: null, index: true })
  deviceId?: string | null;

  @Prop({ type: String, default: null })
  deviceName?: string | null;

  @Prop({ type: String, default: null, index: true })
  ownerId?: string | null;

  @Prop({ type: String, default: null })
  ownerUsername?: string | null;

  @Prop({ type: String, default: null, index: true })
  flowId?: string | null;

  @Prop({ required: true, index: true })
  connectedAt!: Date;

  @Prop({ type: Date, default: null, index: true })
  disconnectedAt?: Date | null;

  @Prop({ type: Boolean, default: false, index: true })
  active!: boolean;

  @Prop({ type: Number, default: 0 })
  clockSkewMs!: number;

  @Prop({ type: Object, required: true })
  messages!: Record<string, unknown>;

  @Prop({ type: Object, required: true })
  logic!: Record<string, unknown>;

  createdAt?: Date;
  updatedAt?: Date;
}

export const MqttPerformanceSessionSchema = SchemaFactory.createForClass(
  MqttPerformanceSessionRecord
);

MqttPerformanceSessionSchema.index(
  { deviceMac: 1, disconnectedAt: -1 },
  { name: 'mqtt_perf_device_history' }
);
MqttPerformanceSessionSchema.index(
  { ownerId: 1, disconnectedAt: -1 },
  { name: 'mqtt_perf_owner_history' }
);
