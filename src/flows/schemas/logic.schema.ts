import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { Flow } from './flow.schema';
import type { CommandExtraction } from '../flow-builder.service';

export type LogicDocument = Logic & Document;

@Schema({ timestamps: true })
export class Logic {
  @ApiProperty({ type: String, description: 'Linked Flow ID' })
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Flow',
    required: true,
    unique: true,
  })
  flowId: Flow;

  @ApiProperty({ description: 'Compiled logic execution graph' })
  @Prop({ type: MongooseSchema.Types.Mixed })
  program: CommandExtraction;
}

export const LogicSchema = SchemaFactory.createForClass(Logic);
