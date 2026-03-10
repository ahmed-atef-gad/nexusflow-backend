import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { Flow } from './flow.schema';
import type { SetupObject } from '../flow-builder.service';

export type SetupDocument = Setup & Document;

@Schema({ timestamps: true })
export class Setup {
  @ApiProperty({ type: String, description: 'Linked Flow ID' })
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Flow',
    required: true,
    unique: true,
  })
  flowId: Flow;

  @ApiProperty({ description: 'Device setup instructions' })
  @Prop({ type: MongooseSchema.Types.Mixed })
  elements: SetupObject;
}

export const SetupSchema = SchemaFactory.createForClass(Setup);
