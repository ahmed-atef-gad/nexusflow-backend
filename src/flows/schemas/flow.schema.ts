import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { User } from 'src/users/schemas/user.schema';
import { Node, NodeSchema } from './node.schema';
import { Edge, EdgeSchema } from './edge.schema';
import { Viewport, ViewportSchema } from './viewport.schema';

export type FlowDocument = Flow & Document;

@Schema({ timestamps: true })
export class Flow {
  @ApiProperty({ example: 'My IoT Flow' })
  @Prop({ required: true })
  name: string;

  @ApiProperty({ type: String, description: 'User ID', required: false })
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: User;

  @ApiProperty({ type: [Node], description: 'List of flow nodes' })
  @Prop({ type: [NodeSchema], default: [] })
  nodes: Node[];

  @ApiProperty({ type: [Edge], description: 'List of flow edges' })
  @Prop({ type: [EdgeSchema], default: [] })
  edges: Edge[];

  @ApiProperty({ type: Viewport })
  @Prop({ type: ViewportSchema })
  viewport: Viewport;

  createdAt?: Date;
  updatedAt?: Date;
}

export const FlowSchema = SchemaFactory.createForClass(Flow);
