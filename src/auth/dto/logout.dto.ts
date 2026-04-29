import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class LogoutDto {
  @ApiPropertyOptional({
    description:
      'Mobile device identifier used during notification token registration.',
    example: 'mobile-device-001',
  })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  deviceId?: string;
}
