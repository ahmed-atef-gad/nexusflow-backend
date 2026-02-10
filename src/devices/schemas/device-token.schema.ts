import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

// Type definition for DeviceToken document with Mongoose Document
export type DeviceTokenDocument = DeviceToken & Document;

// DeviceToken schema with automatic timestamps (createdAt, updatedAt)
@Schema({ timestamps: true })
export class DeviceToken {
  // Public token identifier (UUID)
  @Prop({ required: true, unique: true, index: true })
  tokenId: string;

  // Hashed secret (bcrypt hash of the actual secret)
  @Prop({ required: true })
  tokenHash: string;

  // Reference to the Device this token belongs to
  @Prop({ type: Types.ObjectId, ref: 'Device', required: true })
  deviceId: Types.ObjectId;

  // Permission scopes for this token (e.g., 'flow:read', 'setup:read')
  @Prop({ type: [String], default: [] })
  scopes: string[];

  // Last time this token was used for authentication
  @Prop()
  lastUsedAt: Date;

  // Token expiration date
  @Prop()
  expiresAt: Date;

  // When token was revoked (null if active)
  @Prop()
  revokedAt?: Date;
}

// Create Mongoose schema from class
export const DeviceTokenSchema = SchemaFactory.createForClass(DeviceToken);
