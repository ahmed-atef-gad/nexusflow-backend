import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { RegisterUserDto } from './dto/register-user.dto';
import { VerificationService } from 'src/verification/verification.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

interface AuthenticatedUser {
  _id: string;
  email: string;
  roles: string[];
  username: string;
  token_version?: number;
}

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private verificationService: VerificationService
  ) {}

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Validates a user by email and password.
   * Called by LocalStrategy (which we'll make).
   */
  async validateUser(
    email: string,
    pass: string
  ): Promise<AuthenticatedUser | null> {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.usersService.findOneByEmail(normalizedEmail);
    if (user && (await bcrypt.compare(pass, user.password))) {
      const userObject = user.toObject() as unknown as Record<string, unknown>;
      delete userObject.password;
      return userObject as unknown as AuthenticatedUser;
    }
    return null;
  }

  /**
   * Handles the login request and returns a JWT.
   * Called by the AuthController.
   */
  async login(user: AuthenticatedUser) {
    const userId = String(user._id);

    await this.usersService.updateLastLogin(userId);

    const plainMqttPass = crypto.randomBytes(8).toString('hex');
    const salt = await bcrypt.genSalt();
    const hashedMqttPass = await bcrypt.hash(plainMqttPass, salt);
    await this.usersService.updateMqttPasswordHash(userId, hashedMqttPass);
    const tokenVersion =
      typeof user.token_version === 'number'
        ? user.token_version
        : await this.usersService.getTokenVersionById(userId);
    const payload = {
      email: user.email,
      sub: userId,
      roles: user.roles,
      username: user.username,
      token_version: tokenVersion ?? 0,
    };
    return {
      access_token: this.jwtService.sign(payload),
      mqtt_password: plainMqttPass,
      mqtt_username: user.username,
    };
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    return this.verificationService.generatePasswordResetOtp({
      email: forgotPasswordDto.email,
    });
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const normalizedEmail = this.normalizeEmail(resetPasswordDto.email);
    await this.verificationService.consumePasswordResetOtp({
      email: normalizedEmail,
      otp: resetPasswordDto.otp,
    });

    const saltOrRounds = 10;
    const hashedPassword = await bcrypt.hash(
      resetPasswordDto.newPassword,
      saltOrRounds
    );
    const isPasswordUpdated = await this.usersService.updatePasswordByEmail(
      normalizedEmail,
      hashedPassword
    );
    if (!isPasswordUpdated) {
      throw new UnauthorizedException('Unable to reset password');
    }

    await this.usersService.incrementTokenVersionByEmail(normalizedEmail);
    return { message: 'Password reset successful' };
  }

  async logout(token?: string) {
    if (!token) return;
    try {
      const decoded: { sub?: string } = this.jwtService.verify(token);
      if (!decoded?.sub) return;
      await this.usersService.incrementTokenVersion(decoded.sub);
    } catch {
      // Swallow errors to avoid leaking auth details on logout
      return;
    }
  }

  /**
   * Handles the registration request.
   * Called by the AuthController.
   */
  async register(registerDto: RegisterUserDto) {
    const normalizedEmail = this.normalizeEmail(registerDto.email);
    // Hash the password
    const saltOrRounds = 10;
    const hashedPassword = await bcrypt.hash(
      registerDto.password,
      saltOrRounds
    );

    const userCreationData = {
      ...registerDto,
      email: normalizedEmail,
      password: hashedPassword, // Use the hash, not the plain password
    };

    // Save the user (UsersService will handle this)
    try {
      const createdUser = await this.usersService.register(userCreationData);
      // Don't return the password hash
      const createdUserObject = createdUser.toObject() as unknown as Record<
        string,
        unknown
      >;
      delete createdUserObject.password;

      await this.verificationService.generateOtpForEmail({
        email: normalizedEmail,
      });

      return createdUserObject as unknown as AuthenticatedUser;
    } catch (error: unknown) {
      // Handle errors (e.g., unique email constraint)
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: number }).code === 11000
      ) {
        throw new UnauthorizedException('Email or username already exists');
      }
      throw error;
    }
  }
}
