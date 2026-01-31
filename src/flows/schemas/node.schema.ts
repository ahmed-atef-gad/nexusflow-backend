import { APP_FILTER } from '@nestjs/core';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { Schema as MongooseSchema } from 'mongoose';

@Schema({ _id: false })
export class NodeData {
  @ApiProperty() @Prop() id: string;
  @ApiProperty() @Prop() name: string;
  @ApiProperty() @Prop() moduleId: string;
  @ApiProperty({ required: false }) @Prop() alias?: string;
  @ApiProperty({ required: false }) @Prop() pinMode?: string;
  @ApiProperty({ required: false }) @Prop() type?: string;
  @ApiProperty({ required: false }) @Prop() ports?: string;
  @ApiProperty() @Prop({ type: MongooseSchema.Types.Mixed }) icon: any;
  @ApiProperty({ required: false }) @Prop() color?: string;
  @ApiProperty({ required: false }) @Prop() category?: string;
  @ApiProperty({ required: false })
  @Prop({ type: MongooseSchema.Types.Mixed })
  options: any;
  @ApiProperty({ required: false })
  @Prop({ type: MongooseSchema.Types.Mixed })
  variables: any;
}
const NodeDataSchema = SchemaFactory.createForClass(NodeData);

@Schema({ _id: false })
export class Node {
  @ApiProperty() @Prop() id: string;
  @ApiProperty() @Prop() type: string;
  @ApiProperty() @Prop({ type: MongooseSchema.Types.Mixed }) position: {
    x: number;
    y: number;
  };
  @ApiProperty({ type: NodeData })
  @Prop({ type: NodeDataSchema })
  data: NodeData;
  @ApiProperty() @Prop({ type: MongooseSchema.Types.Mixed }) measured: {
    width: number;
    height: number;
  };
  @ApiProperty({ required: false }) @Prop() selected?: boolean;
  @ApiProperty({ required: false }) @Prop() dragging?: boolean;
}
export const NodeSchema = SchemaFactory.createForClass(Node);
