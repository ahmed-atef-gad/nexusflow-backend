import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { Document } from 'mongoose';

@Schema({ _id: false })
export class Viewport {
  @ApiProperty({ example: 0 })
  @Prop()
  x!: number;

  @ApiProperty({ example: 0 })
  @Prop()
  y!: number;

  @ApiProperty({ example: 1.0 })
  @Prop()
  zoom!: number;
}
export const ViewportSchema = SchemaFactory.createForClass(Viewport);
