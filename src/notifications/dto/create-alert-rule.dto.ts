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
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export type AlertRuleOperator =
  | '>'
  | '<'
  | '>='
  | '<='
  | '='
  | 'between'
  | 'outside';

export class AlertRuleActionDto {
  @ApiProperty({
    enum: ['send_push'],
    example: 'send_push',
  })
  @IsEnum(['send_push'])
  type!: 'send_push';

  @ApiPropertyOptional({
    example: {
      title: 'Gas Leak Alert',
      body: 'MQ2 analog level exceeded threshold',
    },
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

export class CreateAlertRuleDto {
  @ApiProperty({ example: 'MQ2-Sensor-1777061998955-55w' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 200)
  nodeId!: string;

  @ApiProperty({ example: 'MQ2-Sensor' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 120)
  moduleId!: string;

  @ApiProperty({ example: 'analog' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 120)
  readingKey!: string;

  @ApiProperty({
    enum: ['>', '<', '>=', '<=', '=', 'between', 'outside'],
    example: '>',
  })
  @IsEnum(['>', '<', '>=', '<=', '=', 'between', 'outside'])
  operator!: AlertRuleOperator;

  @ApiPropertyOptional({
    example: 300,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Type(() => Number)
  @IsNumber()
  threshold?: number | null;

  @ApiPropertyOptional({
    example: 15,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Type(() => Number)
  @IsNumber()
  min?: number | null;

  @ApiPropertyOptional({
    example: 35,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Type(() => Number)
  @IsNumber()
  max?: number | null;

  @ApiProperty({
    enum: ['critical', 'warning', 'info'],
    example: 'critical',
  })
  @IsEnum(['critical', 'warning', 'info'])
  severity!: 'critical' | 'warning' | 'info';

  @ApiProperty({ example: true })
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({
    type: [AlertRuleActionDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AlertRuleActionDto)
  actions?: AlertRuleActionDto[];
}
