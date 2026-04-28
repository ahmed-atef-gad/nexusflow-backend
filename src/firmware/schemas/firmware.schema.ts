import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FirmwareDocument = HydratedDocument<Firmware>;

@Schema({ timestamps: true })
export class Firmware {
  @Prop({ required: true, unique: true, index: true, trim: true })
  version!: string;

  @Prop({ required: true })
  originalFileName!: string;

  @Prop({ required: true, unique: true })
  storedFileName!: string;

  @Prop({ required: true })
  checksum!: string;

  @Prop({ required: true, min: 1 })
  size!: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  uploadedBy?: Types.ObjectId;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const FirmwareSchema = SchemaFactory.createForClass(Firmware);
