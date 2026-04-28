import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { GenerateOtpDto } from './dto/generate-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { VerificationService } from './verification.service';

@ApiTags('verification')
@Controller('verification')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @ApiOperation({
    summary: 'Generate email verification OTP',
    description:
      'Generates a one-time verification code and sends it to the provided email if an account exists.',
  })
  @ApiBody({ type: GenerateOtpDto })
  @Post('generate')
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } }) // 1 hour
  @ApiCreatedResponse({
    description: 'OTP generated and sent to the provided email',
  })
  @ApiBadRequestResponse({ description: 'No account found for this email' })
  @ApiTooManyRequestsResponse({
    description: 'Too many OTP requests. Please try again later.',
  })
  async generateOtp(@Body() generateOtpDto: GenerateOtpDto) {
    return this.verificationService.generateOtpForEmail(generateOtpDto);
  }

  @ApiOperation({
    summary: 'Verify email OTP',
    description:
      'Validates the submitted OTP and marks the corresponding user email as verified.',
  })
  @ApiBody({ type: VerifyOtpDto })
  @Post('verify')
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } }) // 1 hour
  @ApiCreatedResponse({
    description: 'OTP verified and email marked as verified',
  })
  @ApiUnauthorizedResponse({
    description: 'OTP is invalid, expired, or exhausted',
  })
  async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.verificationService.verifyOtp(verifyOtpDto);
  }
}
