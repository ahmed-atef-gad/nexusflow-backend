import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsPositive,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GetReadingsQueryDto {
  @ApiPropertyOptional({
    description: 'Start of the time range (ISO 8601)',
    example: '2026-07-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'End of the time range (ISO 8601)',
    example: '2026-07-21T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description: 'Maximum number of readings to return (1–2000, default 500)',
    example: 500,
    default: 500,
    minimum: 1,
    maximum: 2000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  @Min(1)
  @Max(2000)
  limit?: number;
}
