import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { Flow } from './flow.schema';
import { UiItem, UiItemSchema } from './uiItem.schema';

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

  @ApiProperty({ description: 'UI elements for the flow', type: [UiItem] })
  @Prop({ type: [UiItemSchema] })
  uiItems: UiItem[];
}

export const UiSchema = SchemaFactory.createForClass(Ui);
