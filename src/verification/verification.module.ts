import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from 'src/users/users.module';
import {
  EmailVerificationOtp,
  EmailVerificationOtpSchema,
} from './schemas/email-verification-otp.schema';
import { SmtpMailService } from './smtp-mail.service';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: EmailVerificationOtp.name, schema: EmailVerificationOtpSchema },
    ]),
  ],
  controllers: [VerificationController],
  providers: [VerificationService, SmtpMailService],
  exports: [VerificationService],
})
export class VerificationModule {}
