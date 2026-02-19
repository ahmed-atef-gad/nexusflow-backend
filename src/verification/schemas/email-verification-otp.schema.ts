import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EmailVerificationOtpDocument = EmailVerificationOtp & Document;

@Schema({ timestamps: true })
export class EmailVerificationOtp {
  @Prop({ required: true, index: true })
  email: string;

  @Prop({ required: true })
  otp_hash: string;

  @Prop({ required: true, expires: 0 })
  expires_at: Date;

  @Prop({ default: 0 })
  failed_attempts: number;

  @Prop({ type: Date, default: null })
  consumed_at: Date | null;
}

export const EmailVerificationOtpSchema =
  SchemaFactory.createForClass(EmailVerificationOtp);
