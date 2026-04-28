import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class TriggerAlertDto {
  @ApiProperty({
    description: 'Project identifier where the alert belongs',
    example: 'project-alpha',
  })
  @IsString()
  @IsNotEmpty()
  @Length(1, 120)
  projectId!: string;

  @ApiProperty({
    description: 'Sensor type that triggered the alert',
    example: 'MQ',
  })
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  sensorType!: string;

  @ApiProperty({
    description: 'Alert severity level',
    enum: ['critical', 'warning', 'info'],
    example: 'critical',
  })
  @IsEnum(['critical', 'warning', 'info'])
  severity!: 'critical' | 'warning' | 'info';

  @ApiPropertyOptional({
    description: 'Optional custom title for push and history entry',
    example: 'Gas Leak Alert',
  })
  @IsOptional()
  @IsString()
  @Length(1, 140)
  title?: string;

  @ApiPropertyOptional({
    description: 'Optional custom message body for push and history entry',
    example: 'MQ level is 430 (threshold 300)',
  })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  body?: string;

  @ApiPropertyOptional({
    description: 'Observed sensor value at trigger time',
    example: 430,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  value?: number;

  @ApiPropertyOptional({
    description: 'Configured threshold for the alert rule',
    example: 300,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  threshold?: number;

  @ApiPropertyOptional({
    description: 'Rule id responsible for this trigger',
    example: 'rule_22',
  })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  ruleId?: string;

  @ApiPropertyOptional({
    description: 'Alert timestamp in ISO format',
    example: '2026-04-19T09:10:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  @ApiPropertyOptional({
    description: 'Optional custom metadata to include in push data payload',
    example: {
      moduleId: 'module_1',
      location: 'Greenhouse #2',
    },
  })
  @IsOptional()
  @IsObject()
  data?: Record<string, string | number | boolean>;
}
