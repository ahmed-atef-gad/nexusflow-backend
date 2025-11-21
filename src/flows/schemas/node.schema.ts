import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

@Schema({ _id: false }) // Sub-schema for Node data
export class NodeData {
  @Prop() id: string;
  @Prop() name: string;
  @Prop() type?: string;
  @Prop() ports?: string;
  @Prop({ type: MongooseSchema.Types.Mixed }) // For flexible objects
  icon: any;
  @Prop() color?: string;
  @Prop() category?: string;
  @Prop({ type: MongooseSchema.Types.Mixed })
  options: any;
  @Prop({ type: MongooseSchema.Types.Mixed })
  variables: any;
}
const NodeDataSchema = SchemaFactory.createForClass(NodeData);

@Schema({ _id: false }) // Main schema for a single Node
export class Node {
  @Prop() id: string;
  @Prop() type: string;
  @Prop({ type: MongooseSchema.Types.Mixed })
  position: { x: number; y: number };
  @Prop({ type: NodeDataSchema })
  data: NodeData;
  @Prop({ type: MongooseSchema.Types.Mixed })
  measured: { width: number; height: number };
  @Prop()
  selected?: boolean;
  @Prop()
  dragging?: boolean;
}
export const NodeSchema = SchemaFactory.createForClass(Node);
