import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';

@Schema({ _id: false })
export class Edge {
  @ApiProperty() @Prop() id: string;
  @ApiProperty() @Prop() source: string;
  @ApiProperty() @Prop() target: string;
  @ApiProperty({ required: false }) @Prop() animated?: boolean;
}
export const EdgeSchema = SchemaFactory.createForClass(Edge);