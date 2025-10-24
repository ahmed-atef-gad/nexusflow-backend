import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Module extends Document {
  @Prop({ required: true })
  name: string;

  @Prop()
  icon: string;

  @Prop()
  color: string;

  @Prop({ required: true })
  category: string;

  @Prop({ enum: ['source', 'target', 'both'], default: 'both' })
  ports: 'source' | 'target' | 'both';

  @Prop()
  type?: string;

  @Prop()
  alias?: string;

  @Prop()
  notes?: string;

  @Prop({ type: Object })
  options?: Record<string, any>;

  @Prop({ type: Map, of: String })
  variables?: Record<string, string>;
}

export const ModuleSchema = SchemaFactory.createForClass(Module);
