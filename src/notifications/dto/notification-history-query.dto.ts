import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, Matches } from 'class-validator';

export class NotificationHistoryQueryDto {
  @ApiPropertyOptional({
    description: 'Return notifications sent on or after this ISO timestamp',
    example: '2026-05-01T10:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  since?: string;

  @ApiPropertyOptional({
    description: 'Number of notifications to return (default 50, max 100)',
    example: '50',
    default: '50',
  })
  @IsOptional()
  @Matches(/^\d+$/, { message: 'limit must be a positive integer string' })
  limit?: string;

  @ApiPropertyOptional({
    description: 'Page number to return (default 1)',
    example: '1',
    default: '1',
  })
  @IsOptional()
  @Matches(/^\d+$/, { message: 'page must be a positive integer string' })
  page?: string;
}
