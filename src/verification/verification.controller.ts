import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { GenerateOtpDto } from './dto/generate-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { VerificationService } from './verification.service';

@ApiTags('verification')
@Controller('verification')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Post('generate')
  @ApiCreatedResponse({
    description: 'OTP generated and sent to the provided email',
  })
  @ApiBadRequestResponse({ description: 'No account found for this email' })
  async generateOtp(@Body() generateOtpDto: GenerateOtpDto) {
    return this.verificationService.generateOtpForEmail(generateOtpDto);
  }

  @Post('verify')
  @ApiCreatedResponse({ description: 'OTP verified and email marked as verified' })
  @ApiUnauthorizedResponse({ description: 'OTP is invalid, expired, or exhausted' })
  async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.verificationService.verifyOtp(verifyOtpDto);
  }
}
