import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

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
    example:
      'eyJvY2N1cnJlZEF0IjoiMjAyNi0wNC0xOVQwOToxMDowMC4wMDBaIiwiaWQiOiI2ODAyZWMzZjdmZDRkYjhhZjE0M2RjZjEifQ==',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;
}
