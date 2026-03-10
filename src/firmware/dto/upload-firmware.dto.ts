import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class UploadFirmwareDto {
  @ApiProperty({
    example: '1.0.0',
    description: 'Firmware version identifier',
  })
  @IsString()
  @IsNotEmpty()
  version: string;
}
