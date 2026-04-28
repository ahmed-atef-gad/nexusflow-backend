import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { Flow } from './flow.schema';
import { UiItem, UiItemSchema } from './uiItem.schema';
import {
  INPUT_GPIO_TASK_NAME,
  OUTPUT_GPIO_TASK_NAME,
} from '../flow-builder.service';

export type UiDocument = Ui & Document;

@Schema({ timestamps: true })
export class Ui {
  @ApiProperty({ type: String, description: 'Linked Flow ID' })
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Flow',
    required: true,
    unique: true,
  })
  flowId!: Flow;

  @ApiProperty({ description: 'MQTT topic for sending commands to modules' })
  @Prop({ type: String, required: false })
  commandTopic?: string;

  @ApiProperty({
    description: 'MQTT topic for resetting WiFi credentials on the device',
  })
  @Prop({ type: String, required: false })
  resetWifiTopic?: string;

  @ApiProperty({
    description: 'MQTT topic for instant execution of tasks on the device',
  })
  @Prop({ type: String, required: false })
  instantExecutionTopic?: string;

  @ApiProperty({
    description:
      'Wildcard MQTT topic pattern for function node runtime errors (per node)',
    required: false,
  })
  @Prop({ type: String, required: false })
  functionErrorTopicPattern?: string;

  @ApiProperty({
    description: 'MQTT topic for runtime logic debug events',
    required: false,
  })
  @Prop({ type: String, required: false })
  logicDebugTopic?: string;

  @ApiProperty({
    description:
      'The Default gpio input task name for GPIO modules in this flow',
  })
  @Prop({ type: String, default: INPUT_GPIO_TASK_NAME })
  gpioInputTaskName?: string;
  @ApiProperty({
    description:
      'The Default gpio output task name for GPIO modules in this flow',
  })
  @Prop({ type: String, default: OUTPUT_GPIO_TASK_NAME })
  gpioOutputTaskName?: string;

  @ApiProperty({ description: 'UI elements for the flow', type: [UiItem] })
  @Prop({ type: [UiItemSchema] })
  uiItems!: UiItem[];
}

export const UiSchema = SchemaFactory.createForClass(Ui);
