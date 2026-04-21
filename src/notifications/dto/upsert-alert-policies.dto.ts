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

export class AlertPolicyInputDto {
  @ApiProperty({
    description: 'Sensor type for this policy',
    example: 'MQ',
  })
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  sensorType: string;

  @ApiProperty({
    description: 'If true, this policy cannot be turned off by user preferences',
    example: true,
  })
  @IsBoolean()
  required: boolean;

  @ApiProperty({
    description: 'If true, threshold must be provided for rule creation',
    example: true,
  })
  @IsBoolean()
  thresholdRequired: boolean;

  @ApiProperty({
    description: 'Default enabled state for optional notifications',
    example: true,
  })
  @IsBoolean()
  defaultEnabled: boolean;

  @ApiProperty({
    description: 'Default severity for this sensor policy',
    enum: ['critical', 'warning', 'info'],
    example: 'critical',
  })
  @IsEnum(['critical', 'warning', 'info'])
  defaultSeverity: 'critical' | 'warning' | 'info';
}

export class UpsertAlertPoliciesDto {
  @ApiProperty({
    type: [AlertPolicyInputDto],
    description: 'Alert policies to upsert',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AlertPolicyInputDto)
  policies: AlertPolicyInputDto[];
}
