import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

// Type definition for Device document with Mongoose Document
export type DeviceDocument = Device & Document;

// Device schema with automatic timestamps (createdAt, updatedAt)
@Schema({ timestamps: true })
export class Device {
  // MAC address - unique identifier for the physical device
  @Prop({ required: true, unique: true, index: true })
  macAddress: string;

  // Friendly name for the device
  @Prop()
  name: string;

  // Reference to the User who owns this device
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId: Types.ObjectId;

  // Reference to the currently active Flow for this device (if any)
  @Prop({ type: Types.ObjectId, ref: 'Flow' })
  activeFlowId?: Types.ObjectId;

  // Status: active or revoked
  @Prop({ default: 'active', enum: ['active', 'revoked'] })
  status: string;

  // Timestamp when device was revoked
  @Prop()
  revokedAt?: Date;
}

// Create Mongoose schema from class
export const DeviceSchema = SchemaFactory.createForClass(Device);
