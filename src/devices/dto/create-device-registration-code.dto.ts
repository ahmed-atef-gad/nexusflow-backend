import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class CreateDeviceRegistrationCodeDto {
  @ApiPropertyOptional({
    description: 'Code expiry in minutes (default 10, max 60)',
    example: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  expiresInMinutes?: number;
}
