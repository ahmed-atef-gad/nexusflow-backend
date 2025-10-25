import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ _id: false })
export class Viewport extends Document {
  @Prop() x: number;
  @Prop() y: number;
  @Prop() zoom: number;
}
export const ViewportSchema = SchemaFactory.createForClass(Viewport);