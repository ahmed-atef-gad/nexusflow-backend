import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';

export class TriggerAlertDto {
  @ApiProperty({ example: '69b58d513b6489cbd6655026' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 120)
  flowId!: string;

  @ApiProperty({ example: '69e7cf54e463e7c6e48fb54d' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 120)
  ruleId!: string;

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
    enum: ['>', '<', '>=', '<=', 'between', 'outside'],
    example: '>',
  })
  @IsEnum(['>', '<', '>=', '<=', 'between', 'outside'])
  operator!: '>' | '<' | '>=' | '<=' | 'between' | 'outside';

  @ApiProperty({ example: 430 })
  @Type(() => Number)
  @IsNumber()
  value!: number;

  @ApiPropertyOptional({ example: 300, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Type(() => Number)
  @IsNumber()
  threshold?: number | null;

  @ApiPropertyOptional({ example: 15, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Type(() => Number)
  @IsNumber()
  min?: number | null;

  @ApiPropertyOptional({ example: 35, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Type(() => Number)
  @IsNumber()
  max?: number | null;

  @ApiPropertyOptional({
    example: '2026-04-22T13:16:20.262Z',
  })
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;
}
