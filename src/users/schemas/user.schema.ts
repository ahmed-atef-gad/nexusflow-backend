import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Role } from '../enums/role.enum';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true })
  username: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ type: String, nullable: true })
  avatarUrl?: string;

  @Prop({ type: [String], default: [Role.User] }) 
  roles: Role[];

  @Prop({ default: true })
  is_active: boolean;

  @Prop({ default: false })
  email_verified: boolean;

  @Prop({ type: String, nullable: true })
  refresh_token?: string;

  @Prop({ type: Date, nullable: true })
  last_login?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);