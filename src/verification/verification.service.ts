import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { UsersService } from 'src/users/users.service';
import { GenerateOtpDto } from './dto/generate-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import {
  EmailVerificationOtp,
  EmailVerificationOtpDocument,
} from './schemas/email-verification-otp.schema';
import { SmtpMailService } from './smtp-mail.service';

@Injectable()
export class VerificationService {
  private readonly otpExpiresMinutes = 10;
  private readonly maxFailedAttempts = 5;

  constructor(
    @InjectModel(EmailVerificationOtp.name)
    private readonly otpModel: Model<EmailVerificationOtpDocument>,
    private readonly usersService: UsersService,
    private readonly smtpMailService: SmtpMailService,
  ) {}

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private async issueOtp(
    email: string,
  ): Promise<{ normalizedEmail: string; otp: string }> {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.usersService.findOneByEmail(normalizedEmail);
    if (!user) {
      throw new BadRequestException('No account found for this email');
    }

    await this.otpModel
      .updateMany(
        {
          email: normalizedEmail,
          consumed_at: null,
          expires_at: { $gt: new Date() },
        },
        { $set: { consumed_at: new Date() } },
      )
      .exec();

    const otp = this.generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + this.otpExpiresMinutes * 60_000);

    await this.otpModel.create({
      email: normalizedEmail,
      otp_hash: otpHash,
      expires_at: expiresAt,
      failed_attempts: 0,
      consumed_at: null,
    });

    return { normalizedEmail, otp };
  }

  async generateOtpForEmail(generateOtpDto: GenerateOtpDto) {
    const { normalizedEmail, otp } = await this.issueOtp(generateOtpDto.email);
    await this.smtpMailService.sendOtpEmail(normalizedEmail, otp);

    return {
      message: 'Verification OTP sent',
      sent_to: normalizedEmail,
      expires_in_minutes: this.otpExpiresMinutes,
    };
  }

  async generateOtpForEmailTest(generateOtpDto: GenerateOtpDto) {
    const { normalizedEmail, otp } = await this.issueOtp(generateOtpDto.email);
    await this.smtpMailService.sendOtpEmail(normalizedEmail, otp);

    return {
      message: 'Test OTP sent',
      sent_to: normalizedEmail,
      otp,
      expires_in_minutes: this.otpExpiresMinutes,
    };
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto) {
    const normalizedEmail = this.normalizeEmail(verifyOtpDto.email);
    const otpDoc = await this.otpModel
      .findOne({
        email: normalizedEmail,
        consumed_at: null,
        expires_at: { $gt: new Date() },
      })
      .sort({ createdAt: -1 })
      .exec();

    if (!otpDoc) {
      throw new UnauthorizedException('OTP is invalid or expired');
    }

    if (otpDoc.failed_attempts >= this.maxFailedAttempts) {
      throw new UnauthorizedException('OTP attempts exceeded');
    }

    const isOtpValid = await bcrypt.compare(verifyOtpDto.otp, otpDoc.otp_hash);

    if (!isOtpValid) {
      await this.otpModel
        .updateOne(
          { _id: otpDoc._id },
          { $inc: { failed_attempts: 1 } },
        )
        .exec();
      throw new UnauthorizedException('OTP is invalid or expired');
    }

    await this.otpModel
      .updateOne(
        { _id: otpDoc._id },
        { $set: { consumed_at: new Date() } },
      )
      .exec();

    await this.usersService.markEmailAsVerifiedByEmail(normalizedEmail);

    return {
      message: 'Email verified successfully',
      email: normalizedEmail,
      verified: true,
    };
  }
}
