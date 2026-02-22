import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DeviceRegistrationCodeDocument = DeviceRegistrationCode & Document;

@Schema({ timestamps: true })
export class DeviceRegistrationCode {
  @Prop({ required: true, index: true })
  code: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId: Types.ObjectId;

  @Prop({ type: Date, required: true, index: true })
  expiresAt: Date;

  @Prop({ type: Date, default: null })
  consumedAt?: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const DeviceRegistrationCodeSchema = SchemaFactory.createForClass(
  DeviceRegistrationCode
);
