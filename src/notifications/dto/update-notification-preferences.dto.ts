import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsString } from 'class-validator';

export class UpdateNotificationPreferencesDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  notificationsEnabled!: boolean;

  @ApiProperty({
    type: [String],
    example: ['push'],
    description: 'Delivery channels. Currently only push is used.',
  })
  @IsArray()
  @IsString({ each: true })
  channels!: string[];
}
