import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Page number, starts from 1',
    example: '1',
    default: '1',
  })
  @IsOptional()
  @Matches(/^\d+$/, { message: 'page must be a positive integer string' })
  page?: string;

  @ApiPropertyOptional({
    description: 'Items per page, max 100',
    example: '10',
    default: '10',
  })
  @IsOptional()
  @Matches(/^\d+$/, { message: 'limit must be a positive integer string' })
  limit?: string;
}
