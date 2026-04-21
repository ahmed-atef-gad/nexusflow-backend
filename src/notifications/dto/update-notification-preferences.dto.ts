import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';

export class SensorNotificationPreferenceInputDto {
  @ApiProperty({
    description: 'Sensor type preference key',
    example: 'HUMIDITY',
  })
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  sensorType: string;

  @ApiProperty({
    description: 'Whether notifications are enabled for this sensor',
    example: true,
  })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({
    required: false,
    description: 'Optional sensor threshold for preference-level tuning',
    example: 72,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  threshold?: number;
}

export class UpdateNotificationPreferencesDto {
  @ApiProperty({
    type: [SensorNotificationPreferenceInputDto],
    description: 'Project-level sensor notification preferences',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SensorNotificationPreferenceInputDto)
  sensors: SensorNotificationPreferenceInputDto[];
}
