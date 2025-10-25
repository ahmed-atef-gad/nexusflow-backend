import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ _id: false })
export class Edge {
  @Prop() id: string;
  @Prop() source: string;
  @Prop() target: string;
  @Prop() animated?: boolean;
}
export const EdgeSchema = SchemaFactory.createForClass(Edge);