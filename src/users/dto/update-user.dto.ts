import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  IsBoolean,
  IsArray,
  IsEnum,
} from 'class-validator';
import { Role } from '../enums/role.enum';

/**
 * Data Transfer Object for updating an existing User.
 *
 * All fields are optional because an update may only modify a single property.
 * This DTO includes all fields for comprehensive internal updates, but external
 * facing controllers should filter or use a more restricted DTO.
 */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(4, 30, { message: 'Username must be between 4 and 30 characters.' })
  username?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Invalid email format.' })
  email?: string;

  @IsOptional()
  @IsString()
  // NOTE: This field is for changing the password. It will be hashed into passwordHash.
  @Length(8, 50, { message: 'Password must be at least 8 characters long.' })
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, and one number or special character.',
  })
  password?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  // --- Administrative Fields ---

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsBoolean()
  email_verified?: boolean;

  @IsOptional()
  @IsArray()
  @IsEnum(Role, {
    each: true,
    message: 'Each role must be a valid Role enum value.',
  })
  roles?: Role[];

  // NOTE: refresh_token and last_login are typically handled by service logic
  // and not passed via DTO, but for completeness in a full admin update DTO:
  @IsOptional()
  @IsString()
  refresh_token?: string; // Should ONLY be set to null or a new hash internally
}
