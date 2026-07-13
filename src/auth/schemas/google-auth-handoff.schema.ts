import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export type GoogleAuthHandoffDocument = HydratedDocument<GoogleAuthHandoff>;

@Schema({ timestamps: true })
export class GoogleAuthHandoff {
  @Prop({ required: true })
  codeHash!: string;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  codeChallenge!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  consumedAt!: Date | null;
}

export const GoogleAuthHandoffSchema =
  SchemaFactory.createForClass(GoogleAuthHandoff);

GoogleAuthHandoffSchema.index({ codeHash: 1 }, { unique: true });
GoogleAuthHandoffSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
