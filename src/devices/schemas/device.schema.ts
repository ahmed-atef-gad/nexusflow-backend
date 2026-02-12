import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';

// Type definition for Device document with Mongoose Document
export type DeviceDocument = Device & Document;

// Device schema with automatic timestamps (createdAt, updatedAt)
@Schema({ timestamps: true })
export class Device {
  // MAC address - unique identifier for the physical device
  @Prop({ required: true, unique: true, index: true })
  macAddress: string;

  // Hashed MQTT password used by the device for broker authentication
  @Prop({
    required: true,
    select: false,
    validate: {
      validator: (value: string) => {
        if (typeof value !== 'string') return false;

        const bcryptPattern = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
        if (bcryptPattern.test(value)) return true;

        const complexityPattern =
          /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
        return complexityPattern.test(value);
      },
      message:
        'mqtt_pass must be at least 8 characters and include uppercase, lowercase, number, and special character',
    },
  })
  mqtt_pass?: string;

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

  // Managed by Mongoose timestamps
  createdAt?: Date;
  updatedAt?: Date;
}

// Create Mongoose schema from class
export const DeviceSchema = SchemaFactory.createForClass(Device);
DeviceSchema.index({ macAddress: 1 }, { unique: true });

DeviceSchema.pre('save', async function (next) {
  if (!this.isModified('mqtt_pass') || !this.mqtt_pass) return next();

  const bcryptPattern = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
  if (bcryptPattern.test(this.mqtt_pass)) return next();

  this.mqtt_pass = await bcrypt.hash(this.mqtt_pass, 10);
  next();
});
