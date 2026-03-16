import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { UsersService } from 'src/users/users.service';
import { GenerateOtpDto } from './dto/generate-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { OtpPurpose } from './enums/otp-purpose.enum';
import {
  EmailVerificationOtp,
  EmailVerificationOtpDocument,
} from './schemas/email-verification-otp.schema';
import { SmtpMailService } from './smtp-mail.service';

@Injectable()
export class VerificationService {
  private readonly otpExpiresMinutes = 3;
  private readonly maxFailedAttempts = 5;
  private readonly otpRateLimitPerHour = 3;
  private readonly otpRateLimitWindowMs = 60 * 60_000;

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

  private getPurposeFilter(
    purpose: OtpPurpose,
  ): OtpPurpose | { $in: (OtpPurpose | null)[] } {
    if (purpose === OtpPurpose.EmailVerification) {
      // Backward compatibility for OTPs created before `purpose` was introduced.
      return { $in: [OtpPurpose.EmailVerification, null] };
    }
    return purpose;
  }

  private async issueOtp(
    email: string,
    purpose: OtpPurpose,
  ): Promise<{ normalizedEmail: string; otp: string }> {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.usersService.findOneByEmail(normalizedEmail);
    if (!user) {
      throw new BadRequestException('No account found for this email');
    }
    await this.assertOtpRateLimit(normalizedEmail, purpose);

    await this.otpModel
      .updateMany(
        {
          email: normalizedEmail,
          purpose: this.getPurposeFilter(purpose),
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
      purpose,
      otp_hash: otpHash,
      expires_at: expiresAt,
      failed_attempts: 0,
      consumed_at: null,
    });

    return { normalizedEmail, otp };
  }

  private async assertOtpRateLimit(
    email: string,
    purpose: OtpPurpose,
  ): Promise<void> {
    const windowStart = new Date(Date.now() - this.otpRateLimitWindowMs);
    const issuedInWindow = await this.otpModel
      .countDocuments({
        email,
        purpose: this.getPurposeFilter(purpose),
        createdAt: { $gte: windowStart },
      })
      .exec();

    if (issuedInWindow >= this.otpRateLimitPerHour) {
      throw new HttpException(
        `You can only request ${this.otpRateLimitPerHour} OTPs per hour. Please try again later.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async consumeOtp(
    email: string,
    otp: string,
    purpose: OtpPurpose,
  ): Promise<string> {
    const normalizedEmail = this.normalizeEmail(email);
    const otpDoc = await this.otpModel
      .findOne({
        email: normalizedEmail,
        purpose: this.getPurposeFilter(purpose),
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

    const isOtpValid = await bcrypt.compare(otp, otpDoc.otp_hash);

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

    return normalizedEmail;
  }

  async generateOtpForEmail(generateOtpDto: GenerateOtpDto) {
    const normalizedEmail = this.normalizeEmail(generateOtpDto.email);
    const user = await this.usersService.findOneByEmail(normalizedEmail);
    if (!user) {
      throw new BadRequestException('No account found for this email');
    }
    if (user.email_verified) {
      return {
        message: 'Email is already verified',
        sent_to: normalizedEmail,
        verified: true,
      };
    }

    const { normalizedEmail: issuedEmail, otp } = await this.issueOtp(
      normalizedEmail,
      OtpPurpose.EmailVerification,
    );
    await this.smtpMailService.sendOtpEmail(
      issuedEmail,
      otp,
      this.otpExpiresMinutes,
    );

    return {
      message: 'Verification OTP sent',
      sent_to: issuedEmail,
      expires_in_minutes: this.otpExpiresMinutes,
    };
  }

  async generateOtpForEmailTest(generateOtpDto: GenerateOtpDto) {
    const normalizedEmail = this.normalizeEmail(generateOtpDto.email);
    const user = await this.usersService.findOneByEmail(normalizedEmail);
    if (!user) {
      throw new BadRequestException('No account found for this email');
    }
    if (user.email_verified) {
      return {
        message: 'Email is already verified',
        sent_to: normalizedEmail,
        verified: true,
      };
    }

    const { normalizedEmail: issuedEmail, otp } = await this.issueOtp(
      normalizedEmail,
      OtpPurpose.EmailVerification,
    );
    await this.smtpMailService.sendOtpEmail(
      issuedEmail,
      otp,
      this.otpExpiresMinutes,
    );

    return {
      message: 'Test OTP sent',
      sent_to: issuedEmail,
      otp,
      expires_in_minutes: this.otpExpiresMinutes,
    };
  }

  async generatePasswordResetOtp(generateOtpDto: GenerateOtpDto) {
    const normalizedEmail = this.normalizeEmail(generateOtpDto.email);
    const user = await this.usersService.findOneByEmail(normalizedEmail);

    // Return generic response to reduce account-enumeration exposure.
    if (!user) {
      return {
        message:
          'If an account exists for this email, a password reset OTP has been sent.',
        expires_in_minutes: this.otpExpiresMinutes,
      };
    }

    const { otp } = await this.issueOtp(
      normalizedEmail,
      OtpPurpose.PasswordReset,
    );
    await this.smtpMailService.sendPasswordResetOtpEmail(
      normalizedEmail,
      otp,
      this.otpExpiresMinutes,
    );

    return {
      message:
        'If an account exists for this email, a password reset OTP has been sent.',
      expires_in_minutes: this.otpExpiresMinutes,
    };
  }

  async consumePasswordResetOtp(verifyOtpDto: VerifyOtpDto): Promise<string> {
    return this.consumeOtp(
      verifyOtpDto.email,
      verifyOtpDto.otp,
      OtpPurpose.PasswordReset,
    );
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto) {
    const normalizedEmail = await this.consumeOtp(
      verifyOtpDto.email,
      verifyOtpDto.otp,
      OtpPurpose.EmailVerification,
    );

    await this.usersService.markEmailAsVerifiedByEmail(normalizedEmail);

    return {
      message: 'Email verified successfully',
      email: normalizedEmail,
      verified: true,
    };
  }
}
