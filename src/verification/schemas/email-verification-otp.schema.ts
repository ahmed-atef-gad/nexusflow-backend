import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { OtpPurpose } from '../enums/otp-purpose.enum';

export type EmailVerificationOtpDocument =
  HydratedDocument<EmailVerificationOtp>;

@Schema({ timestamps: true })
export class EmailVerificationOtp {
  @Prop({ required: true, index: true })
  email!: string;

  @Prop({
    required: true,
    enum: OtpPurpose,
    default: OtpPurpose.EmailVerification,
    index: true,
  })
  purpose!: OtpPurpose;

  @Prop({ required: true })
  otp_hash!: string;

  @Prop({ required: true, expires: 0 })
  expires_at!: Date;

  @Prop({ default: 0 })
  failed_attempts!: number;

  @Prop({ type: Date, default: null })
  consumed_at?: Date | null;
}

export const EmailVerificationOtpSchema =
  SchemaFactory.createForClass(EmailVerificationOtp);

EmailVerificationOtpSchema.index({ email: 1, purpose: 1, createdAt: -1 });
