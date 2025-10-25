import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  IsOptional,
  IsBoolean,
  IsArray,
  IsEnum,
} from 'class-validator';
import { Role } from '../enums/role.enum';

/**
 * Data Transfer Object for creating a new User during registration.
 *
 * Includes optional administrative fields (is_active, email_verified, roles)
 * which can be set by a privileged internal service or an admin user.
 */
export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @Length(4, 30, { message: 'Username must be between 4 and 30 characters.' })
  username: string;

  @IsEmail({}, { message: 'Invalid email format.' })
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @Length(8, 50, { message: 'Password must be at least 8 characters long.' })
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, and one number or special character.',
  })
  password: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  // --- Optional Administrative/Default Fields ---
  // These fields align with the User schema defaults but allow admin override.

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsBoolean()
  email_verified?: boolean;

  @IsOptional()
  @IsArray()
  @IsEnum(Role, { each: true, message: 'Each role must be a valid Role enum value.' })
  roles?: Role.Admin | Role.User;
}
