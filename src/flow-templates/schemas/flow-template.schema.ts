import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { User } from 'src/users/schemas/user.schema';
import { Edge, EdgeSchema } from 'src/flows/schemas/edge.schema';
import { Node, NodeSchema } from 'src/flows/schemas/node.schema';
import { Viewport, ViewportSchema } from 'src/flows/schemas/viewport.schema';

export type FlowTemplateDocument = FlowTemplate & Document;

@Schema({ collection: 'flow_templates', timestamps: true })
export class FlowTemplate {
  @ApiProperty({ example: 'Smart Home Starter' })
  @Prop({ required: true, trim: true })
  name: string;

  @ApiPropertyOptional({
    example: 'Starter automation for common smart-home behaviors.',
  })
  @Prop({ default: '' })
  description?: string;

  @ApiPropertyOptional({ type: [String], example: ['starter', 'iot'] })
  @Prop({ type: [String], default: [] })
  tags?: string[];

  @ApiProperty({
    description: 'Admin user who created this template',
    type: String,
  })
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy: User;

  @ApiProperty({ type: [Node], description: 'Template nodes' })
  @Prop({ type: [NodeSchema], default: [] })
  nodes: Node[];

  @ApiProperty({ type: [Edge], description: 'Template edges' })
  @Prop({ type: [EdgeSchema], default: [] })
  edges: Edge[];

  @ApiPropertyOptional({ type: Viewport })
  @Prop({ type: ViewportSchema })
  viewport?: Viewport;

  createdAt?: Date;
  updatedAt?: Date;
}

export const FlowTemplateSchema = SchemaFactory.createForClass(FlowTemplate);
