import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  notificationsEnabled!: boolean;

  @ApiPropertyOptional({
    type: [String],
    example: ['push'],
    description: 'Delivery channels. Currently only push is used.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  channels?: string[];
}
