import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { User } from 'src/users/schemas/user.schema';
import { Node, NodeSchema } from './node.schema';
import { Edge, EdgeSchema } from './edge.schema';
import { Viewport, ViewportSchema } from './viewport.schema';


@Schema({ timestamps: true })
export class Flow extends Document {
  @Prop({ required: true })
  name: string;

  // This links the module to its owner
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: User;

  @Prop({ type: [NodeSchema], default: [] })
  nodes: Node[];

  @Prop({ type: [EdgeSchema], default: [] })
  edges: Edge[];

  @Prop({ type: ViewportSchema })
  viewport: Viewport;
}

export const FlowSchema = SchemaFactory.createForClass(Flow);