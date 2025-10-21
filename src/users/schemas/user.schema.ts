import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Role } from '../enums/role.enum'; // Import the enum

export type UserDocument = User & Document;

@Schema({ timestamps: true }) // Adds createdAt and updatedAt automatically
export class User {
  @Prop({ required: true, unique: true })
  username: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string; // We'll store the hash, not the password

  @Prop({ type: [String], default: [Role.User] }) // This is the array fix!
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