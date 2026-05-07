import {
  Controller,
  Post,
  Body,
  UnauthorizedException,
  Res,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterUserDto } from './dto/register-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { LogoutDto } from './dto/logout.dto';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response, Request } from 'express';
import { REFRESH_TOKEN_COOKIE } from './utils/auth.util';

type RequestWithCookies = Request & {
  cookies: Record<string, string | undefined>;
};

type ThrottleOptions = {
  default: {
    limit: number;
    ttl: number;
  };
};

const throttle = Throttle as unknown as (
  options: ThrottleOptions
) => ClassDecorator;
/**
 * Authentication endpoints for registration, login, refresh, and logout.
 * Uses short-lived access tokens for API calls and an HttpOnly refresh token cookie for session renewal.
 */
@ApiTags('Authentication')
@throttle({ default: { limit: 3, ttl: 60 * 1000 } }) // Apply a default rate limit to all auth routes
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  private getRefreshCookieOptions() {
    const isProduction = process.env.NODE_ENV === 'production';
    return {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
      secure: isProduction,
      sameSite: 'lax' as const,
    };
  }

  private setRefreshCookie(response: Response, refreshToken: string) {
    response.cookie(
      REFRESH_TOKEN_COOKIE,
      refreshToken,
      this.getRefreshCookieOptions()
    );
  }

  /**
   * Register a new user and set auth cookie.
   *
   * @route POST /auth/register
   * @returns Success message and MQTT credentials
   */
  @Post('register')
  @ApiOperation({
    summary: 'Register a new user',
    description:
      'Creates a new user account, sets the refresh token cookie on success, and returns an access token plus MQTT credentials.',
  })
  @ApiBody({ type: RegisterUserDto })
  @ApiCreatedResponse({
    description:
      'Registration successful, refresh cookie set and access token returned',
    schema: {
      example: {
        message: 'Registration successful',
        access_token: 'eyJhbGciOi...access',
        mqtt: {
          username: 'john_doe',
          password: 'a1b2c3d4e5f6g7h8',
          clientId: 'john_doe',
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Email or username already exists',
    schema: {
      example: {
        statusCode: 401,
        message: 'Email or username already exists',
        error: 'Unauthorized',
      },
    },
  })
  async register(
    @Res({ passthrough: true }) response: Response,
    @Body() registerUserDto: RegisterUserDto
  ) {
    const user = await this.authService.register(registerUserDto);
    const loginResult = await this.authService.login(user);
    this.setRefreshCookie(response, loginResult.refresh_token);
    return {
      message: 'Registration successful',
      access_token: loginResult.access_token,
      mqtt: {
        username: loginResult.mqtt_username,
        password: loginResult.mqtt_password,
        clientId: loginResult.mqtt_username,
      },
    };
  }

  /**
   * Login with email and password and set auth cookie.
   *
   * @route POST /auth/login
   * @returns Success message and MQTT credentials
   */
  @Post('login')
  @ApiOperation({
    summary: 'Login user',
    description:
      'Validates credentials, sets the refresh token cookie, and returns an access token plus MQTT credentials.',
  })
  @ApiBody({ type: LoginUserDto })
  @ApiCreatedResponse({
    description:
      'Login successful, refresh cookie set and access token returned',
    schema: {
      example: {
        message: 'Login successful',
        access_token: 'eyJhbGciOi...access',
        mqtt: {
          username: 'john_doe',
          password: 'a1b2c3d4e5f6g7h8',
          clientId: 'john_doe',
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid credentials',
    schema: {
      example: {
        statusCode: 401,
        message: 'Invalid credentials',
        error: 'Unauthorized',
      },
    },
  })
  async login(
    @Res({ passthrough: true }) response: Response,
    @Body() loginUserDto: LoginUserDto
  ) {
    // First, validate the user
    const user = await this.authService.validateUser(
      loginUserDto.email,
      loginUserDto.password
    );
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    // If valid, issue an access token plus refresh token
    const loginResult = await this.authService.login(user);

    this.setRefreshCookie(response, loginResult.refresh_token);
    return {
      message: 'Login successful',
      access_token: loginResult.access_token,
      mqtt: {
        username: loginResult.mqtt_username,
        password: loginResult.mqtt_password,
        clientId: loginResult.mqtt_username,
      },
    };
  }

  @Post('refresh')
  @ApiOperation({
    summary: 'Refresh access token',
    description:
      'Rotates the refresh token cookie and returns a new access token for authenticated API calls.',
  })
  @ApiCookieAuth(REFRESH_TOKEN_COOKIE)
  @ApiCreatedResponse({
    description: 'Access token refreshed successfully',
    schema: {
      example: {
        access_token: 'eyJhbGciOi...access',
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Refresh token is missing, invalid, or expired',
  })
  async refresh(
    @Req() request: RequestWithCookies,
    @Res({ passthrough: true }) response: Response
  ) {
    const cookies = request.cookies as Record<string, string | undefined>;
    const refreshToken = cookies[REFRESH_TOKEN_COOKIE];
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const refreshedTokens = await this.authService.refresh(refreshToken);
    this.setRefreshCookie(response, refreshedTokens.refresh_token);

    return {
      access_token: refreshedTokens.access_token,
    };
  }

  @Post('forgot-password')
  @ApiOperation({
    summary: 'Request password reset OTP',
    description:
      'Sends a one-time password reset code to the user email if the account exists.',
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiCreatedResponse({
    description: 'Password reset OTP request accepted',
    schema: {
      example: {
        message:
          'If an account exists for this email, a password reset OTP has been sent.',
        expires_in_minutes: 3,
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Post('reset-password')
  @ApiOperation({
    summary: 'Reset password using OTP',
    description:
      'Verifies the reset OTP and updates the account password. Existing sessions are invalidated.',
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiCreatedResponse({
    description: 'Password reset successful',
    schema: {
      example: {
        message: 'Password reset successful',
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - OTP is invalid or expired',
  })
  async resetPassword(
    @Res({ passthrough: true }) response: Response,
    @Body() resetPasswordDto: ResetPasswordDto
  ) {
    const result = await this.authService.resetPassword(resetPasswordDto);
    response.clearCookie(REFRESH_TOKEN_COOKIE, this.getRefreshCookieOptions());
    return result;
  }

  /**
   * Logout the current user by clearing the auth cookie.
   *
   * @route POST /auth/logout
   * @returns Success message
   */
  @Post('logout')
  @ApiOperation({
    summary: 'Logout user',
    description:
      'Clears the refresh token cookie and invalidates existing tokens by bumping token version. If `deviceId` is provided, the matching FCM token registration for that authenticated user is removed.',
  })
  @ApiBody({ type: LogoutDto, required: false })
  @ApiResponse({
    status: 200,
    description: 'Logout successful',
    schema: {
      example: {
        message: 'Logged out successfully.',
        fcmTokenCleared: true,
      },
    },
  })
  async logout(
    @Req() request: RequestWithCookies,
    @Body() body: LogoutDto,
    @Res({ passthrough: true }) response: Response
  ) {
    const cookies = request.cookies as Record<string, string | undefined>;
    const refreshToken = cookies[REFRESH_TOKEN_COOKIE];
    const result = await this.authService.logout(refreshToken, body?.deviceId);
    response.clearCookie(REFRESH_TOKEN_COOKIE, this.getRefreshCookieOptions());
    return {
      message: 'Logged out successfully.',
      fcmTokenCleared: result.fcmTokenCleared,
    };
  }
}
