import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class GenerateOtpDto {
  @ApiProperty({
    example: 'john@example.com',
    description: 'Target email address to send verification OTP to',
  })
  @IsEmail()
  email: string;
}
