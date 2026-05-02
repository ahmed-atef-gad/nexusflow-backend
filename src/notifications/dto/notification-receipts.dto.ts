import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class NotificationReceiptsDto {
  @ApiProperty({
    type: [String],
    example: ['uuid1', 'uuid2'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @Length(1, 120, { each: true })
  notification_ids!: string[];

  @ApiProperty({
    required: false,
    example: '2026-05-02T10:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  received_at?: string;
}
