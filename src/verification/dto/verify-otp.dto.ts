import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, Matches } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({
    example: 'john@example.com',
    description: 'Email used when generating the OTP',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: '123456',
    description: '6-digit OTP code sent to the email',
  })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  otp: string;
}
