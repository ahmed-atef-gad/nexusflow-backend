import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export type AlertComparisonOperator =
  | '>'
  | '<'
  | '>='
  | '<='
  | 'between'
  | 'outside';

export class AlertPolicyInputDto {
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

  @ApiProperty({ example: 'MQ2 Gas Level (Analog)' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 160)
  label!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  required!: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  thresholdRequired!: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  defaultEnabled!: boolean;

  @ApiProperty({
    enum: ['critical', 'warning', 'info'],
    example: 'critical',
  })
  @IsEnum(['critical', 'warning', 'info'])
  defaultSeverity!: 'critical' | 'warning' | 'info';

  @ApiProperty({
    type: [String],
    enum: ['>', '<', '>=', '<=', 'between', 'outside'],
    example: ['>', '<', '>=', '<='],
  })
  @IsArray()
  @IsEnum(['>', '<', '>=', '<=', 'between', 'outside'], { each: true })
  supportedOperators!: AlertComparisonOperator[];

  @ApiProperty({ example: true })
  @IsBoolean()
  isActive!: boolean;
}

export class UpsertAlertPoliciesDto {
  @ApiProperty({ type: [AlertPolicyInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AlertPolicyInputDto)
  policies!: AlertPolicyInputDto[];
}
