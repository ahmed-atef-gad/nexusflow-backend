import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { Flow } from './flow.schema';

export type UiDocument = Ui & Document;

@Schema({ timestamps: true })
export class Ui {
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
  elements: any[];
}

export const UiSchema = SchemaFactory.createForClass(Ui);
