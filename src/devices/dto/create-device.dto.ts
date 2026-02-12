import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Validate,
  
  
} from 'class-validator';

export class CreateDeviceDto {
  @ApiProperty({
    description: 'MAC address of the device (e.g., AA:BB:CC:DD:EE:FF)',
    example: 'A1:B2:C4:D4:E5:D6',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/, {
    message: 'macAddress must be a valid MAC address in format XX:XX:XX:XX:XX:XX',
  })
 
  macAddress: string;

  @ApiProperty({
    description:
      'MQTT password. Must be at least 8 characters and include uppercase, lowercase, number, and special character.',
    example: 'Akram209!',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/, {
    message:
      'mqtt_pass must be at least 8 characters and include uppercase, lowercase, number, and special character',
  })
  mqtt_pass: string;

  @ApiPropertyOptional({
    description: 'Optional friendly name for the device',
    example: 'My Smart ESP32',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;
}
