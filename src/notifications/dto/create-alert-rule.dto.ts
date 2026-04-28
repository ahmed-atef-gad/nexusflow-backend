import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';

export class AlertRuleActionDto {
  @ApiProperty({
    enum: ['device_action', 'send_push'],
    example: 'send_push',
  })
  @IsEnum(['device_action', 'send_push'])
  type!: 'device_action' | 'send_push';

  @ApiPropertyOptional({
    description: 'Optional topic override for push action',
    example: 'project.project-alpha.critical',
  })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  topic?: string;

  @ApiPropertyOptional({
    description: 'Optional template id for message composition',
    example: 'gas_alert_template',
  })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  templateId?: string;

  @ApiPropertyOptional({
    description: 'Optional payload for action execution',
    example: {
      title: 'Gas Leak Alert',
      body: 'MQ level exceeded threshold',
    },
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

export class CreateAlertRuleDto {
  @ApiProperty({
    description: 'Sensor type this rule listens to',
    example: 'MQ',
  })
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  sensorType!: string;

  @ApiProperty({
    enum: ['>', '<', '>=', '<=', '==', '!='],
    example: '>',
  })
  @IsEnum(['>', '<', '>=', '<=', '==', '!='])
  operator!: '>' | '<' | '>=' | '<=' | '==' | '!=';

  @ApiProperty({
    description: 'Threshold value for rule trigger',
    example: 300,
  })
  @Type(() => Number)
  @IsNumber()
  threshold!: number;

  @ApiProperty({
    description: 'Severity when rule is triggered',
    enum: ['critical', 'warning', 'info'],
    example: 'critical',
  })
  @IsEnum(['critical', 'warning', 'info'])
  severity!: 'critical' | 'warning' | 'info';

  @ApiPropertyOptional({
    description: 'Whether rule is active',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    type: [AlertRuleActionDto],
    description: 'Actions executed when rule condition matches',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AlertRuleActionDto)
  actions?: AlertRuleActionDto[];
}
