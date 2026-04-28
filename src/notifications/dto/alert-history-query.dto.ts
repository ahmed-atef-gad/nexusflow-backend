import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class AlertHistoryQueryDto {
  @ApiPropertyOptional({
    description: 'Number of alerts to return (default 50, max 100)',
    example: '50',
    default: '50',
  })
  @IsOptional()
  @Matches(/^\d+$/, { message: 'limit must be a positive integer string' })
  limit?: string;

  @ApiPropertyOptional({
    description: 'Cursor from previous response for next page',
    example: '69e7d01de463e7c6e48fb552',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Filter by node instance id',
    example: 'MQ2-Sensor-1777061998955-55w',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nodeId?: string;

  @ApiPropertyOptional({
    enum: ['critical', 'warning', 'info'],
    example: 'critical',
  })
  @IsOptional()
  @IsEnum(['critical', 'warning', 'info'])
  severity?: 'critical' | 'warning' | 'info';
}
