import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

// Type definition for DeviceAudit document with Mongoose Document
export type DeviceAuditDocument = DeviceAudit & Document;

// DeviceAudit schema with automatic timestamps (createdAt, updatedAt)
@Schema({ timestamps: true })
export class DeviceAudit {
  // Reference to the Device
  @Prop({ type: Types.ObjectId, ref: 'Device', required: true, index: true })
  deviceId: Types.ObjectId;

  // Action performed (e.g., 'TOKEN_VALIDATION', 'CONFIG_FETCH')
  @Prop()
  action: string;

  // IP address of the request
  @Prop()
  ip: string;

  // User agent from the request
  @Prop()
  userAgent: string;

  // HTTP response status code
  @Prop()
  statusCode: number;

  // Additional metadata for the audit log
  @Prop({ type: Object })
  metadata: any;
}

// Create Mongoose schema from class
export const DeviceAuditSchema = SchemaFactory.createForClass(DeviceAudit);
