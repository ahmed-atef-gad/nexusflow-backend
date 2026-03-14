import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';

@Schema({ _id: false })
export class UiItem {
  @ApiProperty({
    type: String,
    description: 'Module ID associated with this UI item',
  })
  @Prop()
  moduleId: string;

  @ApiProperty({
    type: String,
    description: 'Module name associated with this UI item',
  })
  @Prop()
  moduleName: string;

  @ApiProperty({
    required: false,
    description: 'Optional alias for this UI item',
  })
  @Prop()
  alias?: string;

  @ApiProperty({
    required: false,
    description: 'Optional user-friendly name for task scheduling',
  })
  @Prop()
  taskName?: string;

  @ApiProperty({ type: String, description: 'Topic for this UI item' })
  @Prop()
  topic: string;

  @ApiProperty({
    required: false,
    description: 'Optional MQTT topic to receive responses for this UI item',
  })
  @Prop()
  responseTopic?: string;

  @ApiProperty({
    type: String,
    description: 'Type of module (input, output, etc.)',
  })
  @Prop()
  moduleType: 'input' | 'output' | 'other';

  @ApiProperty({
    required: false,
    description: 'Optional pin number for module associated with this UI item',
  })
  @Prop()
  pin?: number;

  @ApiProperty({
    required: false,
    description: 'Optional digital pin number for dual-mode sensors',
  })
  @Prop()
  digitalPin?: number;

  @ApiProperty({
    required: false,
    description: 'Optional analog pin number for dual-mode sensors',
  })
  @Prop()
  analogPin?: number;

  @ApiProperty({
    required: false,
    description: 'Indicates if this UI item uses a digital pin',
  })
  @Prop()
  isDigital?: boolean;

  @ApiProperty({
    required: false,
    description: 'Indicates if this UI item uses an analog pin',
  })
  @Prop()
  isAnalog?: boolean;

  @ApiProperty({
    required: false,
    description:
      'For output modules: true if not connected to any input module (can be freely controlled from the frontend)',
  })
  @Prop()
  isFloating?: boolean;
}

export const UiItemSchema = SchemaFactory.createForClass(UiItem);
