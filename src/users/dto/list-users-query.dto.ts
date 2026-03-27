import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Role } from '../enums/role.enum';

export class ListUsersQueryDto {
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

  @ApiPropertyOptional({
    description: 'Case-insensitive search against username and email',
    example: 'john',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by role',
    enum: Role,
    example: Role.User,
  })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({
    description: 'Filter by active status',
    enum: ['true', 'false'],
    example: 'true',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  is_active?: 'true' | 'false';
}
