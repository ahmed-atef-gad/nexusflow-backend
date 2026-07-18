import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  type RefreshTokenState,
  UsersService,
} from 'src/users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Model } from 'mongoose';
import { RegisterUserDto } from './dto/register-user.dto';
import { VerificationService } from 'src/verification/verification.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import {
  NotificationDeviceToken,
  NotificationDeviceTokenDocument,
} from 'src/notifications/schemas/notification-device-token.schema';

export interface AuthenticatedUser {
  _id: string;
  email: string;
  roles: string[];
  username: string;
  token_version?: number;
  is_active?: boolean;
  email_verified?: boolean;
  requires_email_verification?: boolean;
}

interface SessionTokens {
  access_token: string;
  refresh_token: string;
}

interface AccessToken {
  access_token: string;
}

interface RefreshResult extends AccessToken {
  refresh_token?: string;
}

interface RefreshTokenPayload {
  sub: string;
  email: string;
  roles: string[];
  username: string;
  token_version: number;
  jti?: string;
}

interface GoogleProfileInput {
  googleId: string;
  email?: string;
  emailVerified: boolean;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
}

type RefreshTokenMatch =
  | {
      kind: 'current';
      source: RefreshTokenState['source'];
      refreshTokenJti: string | null;
    }
  | { kind: 'previous'; source: RefreshTokenState['source'] }
  | null;

const REFRESH_TOKEN_ROTATION_GRACE_MS = 30_000;

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private verificationService: VerificationService,
    @InjectModel(NotificationDeviceToken.name)
    private readonly notificationDeviceTokenModel: Model<NotificationDeviceTokenDocument>
  ) {}

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private getAccessTokenSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is not set');
    }
    return secret;
  }

  private getRefreshTokenSecret(): string {
    const secret = process.env.JWT_REFRESH_SECRET ?? process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_REFRESH_SECRET environment variable is not set');
    }
    return secret;
  }

  private getAccessTokenExpiresIn(): string {
    return process.env.JWT_ACCESS_EXPIRES_IN ?? '15m';
  }

  private getRefreshTokenExpiresIn(): string {
    return process.env.JWT_REFRESH_EXPIRES_IN ?? '7d';
  }

  private getRefreshTokenRotationGraceMs(): number {
    const configuredGraceMs = Number(process.env.JWT_REFRESH_ROTATION_GRACE_MS);
    if (Number.isFinite(configuredGraceMs) && configuredGraceMs >= 0) {
      return configuredGraceMs;
    }
    return REFRESH_TOKEN_ROTATION_GRACE_MS;
  }

  private async hashRefreshToken(refreshToken: string): Promise<string> {
    const salt = await bcrypt.genSalt();
    return bcrypt.hash(refreshToken, salt);
  }

  private async buildTokenPayload(
    user: AuthenticatedUser
  ): Promise<RefreshTokenPayload> {
    const userId = String(user._id);
    const tokenVersion =
      typeof user.token_version === 'number'
        ? user.token_version
        : await this.usersService.getTokenVersionById(userId);

    return {
      email: user.email,
      sub: userId,
      roles: user.roles,
      username: user.username,
      token_version: tokenVersion ?? 0,
    };
  }

  private issueAccessToken(payload: RefreshTokenPayload): string {
    return this.jwtService.sign(payload, {
      secret: this.getAccessTokenSecret(),
      expiresIn: this.getAccessTokenExpiresIn() as never,
    });
  }

  private issueRefreshToken(payload: RefreshTokenPayload): {
    refresh_token: string;
    refreshTokenJti: string;
  } {
    const refreshTokenJti = crypto.randomUUID();
    const refresh_token = this.jwtService.sign(
      { ...payload, jti: refreshTokenJti },
      {
        secret: this.getRefreshTokenSecret(),
        expiresIn: this.getRefreshTokenExpiresIn() as never,
      }
    );

    return { refresh_token, refreshTokenJti };
  }

  private async issueSessionTokens(
    user: AuthenticatedUser
  ): Promise<SessionTokens> {
    const payload = await this.buildTokenPayload(user);
    const access_token = this.issueAccessToken(payload);
    const { refresh_token, refreshTokenJti } = this.issueRefreshToken(payload);

    await this.usersService.setRefreshTokenState(
      payload.sub,
      await this.hashRefreshToken(refresh_token),
      refreshTokenJti
    );

    return { access_token, refresh_token };
  }

  private async verifyRefreshToken(
    refreshToken: string
  ): Promise<RefreshTokenPayload> {
    return this.jwtService.verifyAsync<RefreshTokenPayload>(refreshToken, {
      secret: this.getRefreshTokenSecret(),
    });
  }

  private async getRefreshTokenMatch(
    refreshToken: string,
    payload: RefreshTokenPayload
  ): Promise<RefreshTokenMatch> {
    const tokenStates = await this.usersService.getRefreshTokenStatesById(
      payload.sub
    );
    if (!tokenStates?.length) return null;

    for (const tokenState of tokenStates) {
      if (!tokenState.refreshTokenHash) continue;

      const currentJtiMatches =
        !tokenState.refreshTokenJti ||
        !payload.jti ||
        tokenState.refreshTokenJti === payload.jti;
      if (
        currentJtiMatches &&
        (await bcrypt.compare(refreshToken, tokenState.refreshTokenHash))
      ) {
        return {
          kind: 'current',
          source: tokenState.source,
          refreshTokenJti: tokenState.refreshTokenJti,
        };
      }

      const previousTokenStillValid =
        tokenState.previousRefreshTokenExpiresAt !== null &&
        tokenState.previousRefreshTokenExpiresAt.getTime() > Date.now();
      const previousJtiMatches =
        !tokenState.previousRefreshTokenJti ||
        !payload.jti ||
        tokenState.previousRefreshTokenJti === payload.jti;
      if (
        previousTokenStillValid &&
        previousJtiMatches &&
        tokenState.previousRefreshTokenHash &&
        (await bcrypt.compare(refreshToken, tokenState.previousRefreshTokenHash))
      ) {
        return { kind: 'previous', source: tokenState.source };
      }
    }

    return null;
  }

  private stripSensitiveUserFields(user: unknown): AuthenticatedUser {
    const userObject =
      typeof (user as { toObject?: () => unknown }).toObject === 'function'
        ? ((user as { toObject: () => unknown }).toObject() as Record<
            string,
            unknown
          >)
        : ({ ...(user as Record<string, unknown>) } as Record<string, unknown>);

    delete userObject.password;
    delete userObject.google_id;
    delete userObject.refresh_token;
    delete userObject.mqtt_pass_hash;
    return userObject as unknown as AuthenticatedUser;
  }

  private buildGoogleUsernameSeed(input: GoogleProfileInput): string {
    const name = [input.firstName, input.lastName].filter(Boolean).join(' ');
    return name || input.displayName || input.email?.split('@')[0] || 'user';
  }

  getGoogleAuthorizationUrl(state: string): string {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const callbackUrl = process.env.GOOGLE_CALLBACK;
    if (!clientId || !callbackUrl) {
      throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CALLBACK must be set');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
      include_granted_scopes: 'true',
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
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
    if (
      user &&
      user.password &&
      user.is_active !== false &&
      (await bcrypt.compare(pass, user.password))
    ) {
      if (user.email_verified === false) {
        await this.verificationService.generateOtpForEmail({
          email: normalizedEmail,
        });
        throw new UnauthorizedException('Email must be verified first');
      }
      return this.stripSensitiveUserFields(user);
    }
    return null;
  }

  private async requireEmailVerification(email: string): Promise<void> {
    await this.verificationService.generateOtpForEmail({
      email,
    });
  }

  async validateGoogleUser(
    profile: GoogleProfileInput
  ): Promise<AuthenticatedUser> {
    if (!profile.googleId || !profile.email) {
      throw new UnauthorizedException('Google profile is missing an email');
    }
    if (!profile.emailVerified) {
      throw new UnauthorizedException('Google email is not verified');
    }

    const normalizedEmail = this.normalizeEmail(profile.email);
    const googleUser = await this.usersService.findOneByGoogleId(
      profile.googleId
    );
    if (googleUser) {
      if (googleUser.is_active === false) {
        throw new UnauthorizedException('Account is disabled');
      }
      if (googleUser.email_verified === false) {
        await this.requireEmailVerification(normalizedEmail);
        return {
          ...this.stripSensitiveUserFields(googleUser),
          requires_email_verification: true,
        };
      }
      return this.stripSensitiveUserFields(googleUser);
    }

    const existingUser =
      await this.usersService.findOneByEmailWithGoogleId(normalizedEmail);
    if (existingUser) {
      if (existingUser.is_active === false) {
        throw new UnauthorizedException('Account is disabled');
      }
      if (existingUser.email_verified === false) {
        const existingGoogleId = (
          existingUser.toObject() as unknown as { google_id?: string }
        ).google_id;
        if (existingGoogleId && existingGoogleId !== profile.googleId) {
          throw new UnauthorizedException(
            'This email is already linked to another Google account'
          );
        }

        if (!existingGoogleId) {
          const linkedUser = await this.usersService.linkGoogleAccount(
            String(existingUser._id),
            profile.googleId,
            existingUser.avatarUrl ? undefined : profile.avatarUrl
          );
          if (!linkedUser) {
            throw new UnauthorizedException('Unable to link Google account');
          }
        }

        await this.requireEmailVerification(normalizedEmail);
        return {
          ...this.stripSensitiveUserFields(existingUser),
          requires_email_verification: true,
        };
      }

      const existingGoogleId = (
        existingUser.toObject() as unknown as { google_id?: string }
      ).google_id;
      if (existingGoogleId && existingGoogleId !== profile.googleId) {
        throw new UnauthorizedException(
          'This email is already linked to another Google account'
        );
      }

      const linkedUser = await this.usersService.linkGoogleAccount(
        String(existingUser._id),
        profile.googleId,
        existingUser.avatarUrl ? undefined : profile.avatarUrl
      );
      if (!linkedUser) {
        throw new UnauthorizedException('Unable to link Google account');
      }
      return this.stripSensitiveUserFields(linkedUser);
    }

    const username = await this.usersService.createAvailableUsername(
      this.buildGoogleUsernameSeed({ ...profile, email: normalizedEmail })
    );
    const createdUser = await this.usersService.createGoogleUser({
      googleId: profile.googleId,
      email: normalizedEmail,
      username,
      avatarUrl: profile.avatarUrl,
    });

    await this.requireEmailVerification(normalizedEmail);

    return {
      ...this.stripSensitiveUserFields(createdUser),
      requires_email_verification: true,
    };
  }

  /**
   * Handles the login request and returns an access token plus refresh token.
   * Called by the AuthController.
   */
  async login(user: AuthenticatedUser) {
    if (user.is_active === false) {
      throw new UnauthorizedException('Account is disabled');
    }

    const userId = String(user._id);

    await this.usersService.updateLastLogin(userId);

    const plainMqttPass = crypto.randomBytes(8).toString('hex');
    const salt = await bcrypt.genSalt();
    const hashedMqttPass = await bcrypt.hash(plainMqttPass, salt);
    await this.usersService.updateMqttPasswordHash(userId, hashedMqttPass);
    const tokens = await this.issueSessionTokens(user);
    return {
      ...tokens,
      mqtt_password: plainMqttPass,
      mqtt_username: user.username,
    };
  }

  async getAuthenticatedUserById(userId: string): Promise<AuthenticatedUser> {
    const authState = await this.usersService.getAuthStateById(userId);
    if (!authState || !authState.isActive) {
      throw new UnauthorizedException('Invalid Google handoff user');
    }

    return {
      _id: userId,
      email: authState.email,
      username: authState.username,
      roles: authState.roles,
      token_version: authState.tokenVersion,
      is_active: authState.isActive,
      email_verified: authState.emailVerified,
      requires_email_verification: !authState.emailVerified,
    };
  }

  async refresh(refreshToken: string): Promise<RefreshResult> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const authState = await this.usersService.getAuthStateById(payload.sub);
    if (
      !authState ||
      !authState.isActive ||
      authState.tokenVersion !== payload.token_version
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const refreshTokenMatch = await this.getRefreshTokenMatch(
      refreshToken,
      payload
    );
    if (!refreshTokenMatch) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const nextPayload: RefreshTokenPayload = {
      sub: payload.sub,
      email: authState.email || payload.email,
      roles: authState.roles,
      username: authState.username || payload.username,
      token_version: authState.tokenVersion,
    };
    const access_token = this.issueAccessToken(nextPayload);

    if (refreshTokenMatch.kind === 'previous') {
      return { access_token };
    }

    const { refresh_token, refreshTokenJti } =
      this.issueRefreshToken(nextPayload);
    const didRotate = await this.usersService.rotateRefreshTokenState(
      payload.sub,
      {
        expectedRefreshTokenJti: refreshTokenMatch.refreshTokenJti,
        refreshTokenHash: await this.hashRefreshToken(refresh_token),
        refreshTokenJti,
        previousRefreshTokenHash: await this.hashRefreshToken(refreshToken),
        previousRefreshTokenJti: payload.jti ?? null,
        previousRefreshTokenExpiresAt: new Date(
          Date.now() + this.getRefreshTokenRotationGraceMs()
        ),
      }
    );
    if (!didRotate) {
      return { access_token };
    }

    return {
      access_token,
      refresh_token,
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

  async logout(
    refreshToken?: string,
    deviceId?: string
  ): Promise<{ fcmTokenCleared: boolean }> {
    if (!refreshToken) return { fcmTokenCleared: false };

    const normalizedDeviceId = deviceId?.trim();
    let userId: string | undefined;
    try {
      const decoded = await this.verifyRefreshToken(refreshToken);
      userId = decoded.sub;
      const refreshTokenMatch = await this.getRefreshTokenMatch(
        refreshToken,
        decoded
      );
      if (!refreshTokenMatch) {
        return { fcmTokenCleared: false };
      }
      await this.usersService.clearRefreshToken(userId, decoded.jti ?? null);
    } catch {
      // Swallow errors to avoid leaking auth details on logout
      return { fcmTokenCleared: false };
    }

    if (!normalizedDeviceId) {
      return { fcmTokenCleared: false };
    }

    const deletion = await this.notificationDeviceTokenModel
      .deleteOne({
        userId,
        deviceId: normalizedDeviceId,
      })
      .exec();

    return { fcmTokenCleared: (deletion.deletedCount ?? 0) > 0 };
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
