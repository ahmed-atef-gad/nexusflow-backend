import {
  Controller,
  Get,
  Post,
  Body,
  UnauthorizedException,
  Res,
  Req,
  UseGuards,
  UseFilters,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import type { AuthenticatedUser } from './auth.service';
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
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response, Request } from 'express';
import { REFRESH_TOKEN_COOKIE } from './utils/auth.util';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '../security/csrf.constants';
import {
  clearCsrfCookie,
  CSRF_RESPONSE_LOCAL_KEY,
  ensureCsrfCookie,
} from '../security/csrf.util';
import { getCrossSiteCookieOptions } from '../security/cookie-options.util';
import { GoogleOAuthGuard } from '../guards/auth/google-oauth.guard';
import { GoogleOAuthExceptionFilter } from './filters/google-oauth-exception.filter';
import {
  clearGoogleOAuthStateCookie,
  createGoogleOAuthState,
  getGoogleOAuthStateCookieOptions,
  GOOGLE_OAUTH_STATE_COOKIE,
} from './utils/oauth-state.util';

type RequestWithCookies = Request & {
  cookies: Record<string, string | undefined>;
};

type GoogleAuthRequest = RequestWithCookies & {
  user: AuthenticatedUser;
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
    return {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
      ...getCrossSiteCookieOptions(),
    };
  }

  private setRefreshCookie(response: Response, refreshToken: string) {
    response.cookie(
      REFRESH_TOKEN_COOKIE,
      refreshToken,
      this.getRefreshCookieOptions()
    );
  }

  private getCsrfTokenForRedirect(
    request: RequestWithCookies,
    response: Response
  ): string {
    const localToken = response.locals?.[CSRF_RESPONSE_LOCAL_KEY];
    return typeof localToken === 'string'
      ? localToken
      : ensureCsrfCookie(request, response);
  }

  private addCsrfRedirectParams(url: URL, csrfToken: string): void {
    url.searchParams.set('csrf_token', csrfToken);
    url.searchParams.set('csrf_header', CSRF_HEADER_NAME);
  }

  @Get('csrf-token')
  @Throttle({ default: { limit: 60, ttl: 60 * 1000 } })
  @ApiOperation({
    summary: 'Get CSRF token',
    description:
      'Sets a signed CSRF cookie and returns the same token. Send this value in the x-csrf-token header for POST, PUT, PATCH, and DELETE requests.',
  })
  @ApiCookieAuth(CSRF_COOKIE_NAME)
  @ApiOkResponse({
    description: 'CSRF token issued successfully',
    schema: {
      example: {
        csrf_token: 'nonce.signature',
        header_name: CSRF_HEADER_NAME,
        cookie_name: CSRF_COOKIE_NAME,
      },
    },
  })
  getCsrfToken(
    @Req() request: RequestWithCookies,
    @Res({ passthrough: true }) response: Response
  ) {
    return {
      csrf_token: ensureCsrfCookie(request, response),
      header_name: CSRF_HEADER_NAME,
      cookie_name: CSRF_COOKIE_NAME,
    };
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

  @Get('google')
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  @ApiOperation({
    summary: 'Start Google login',
    description:
      'Creates a signed OAuth state cookie and redirects the browser to Google for login or registration.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirects to Google OAuth consent screen',
  })
  startGoogleLogin(@Res() response: Response) {
    const state = createGoogleOAuthState();
    response.cookie(
      GOOGLE_OAUTH_STATE_COOKIE,
      state,
      getGoogleOAuthStateCookieOptions()
    );
    return response.redirect(this.authService.getGoogleAuthorizationUrl(state));
  }

  @Get('google/callback')
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  @UseGuards(GoogleOAuthGuard)
  @UseFilters(GoogleOAuthExceptionFilter)
  @ApiOperation({
    summary: 'Google OAuth callback',
    description:
      'Validates Google OAuth state, signs in or creates the user using a verified Google email, sets the refresh token cookie, and redirects to the frontend with the access token and CSRF token needed for refresh requests.',
  })
  @ApiResponse({
    status: 302,
    description:
      'Redirects to frontend: /auth/google/callback?token={access_token}&csrf_token={csrf_token}&csrf_header=x-csrf-token on success, /auth/google/callback?error={code} on failure',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid state or Google profile',
  })
  async googleCallback(
    @Req() request: GoogleAuthRequest,
    @Res() response: Response
  ) {
    clearGoogleOAuthStateCookie(response);
    const frontendUrl = this.getFrontendUrl();
    const csrfToken = this.getCsrfTokenForRedirect(request, response);

    if (request.user.requires_email_verification) {
      const callbackUrl = new URL('/auth/google/callback', frontendUrl);
      callbackUrl.searchParams.set('verification_required', 'true');
      callbackUrl.searchParams.set('email', request.user.email);
      this.addCsrfRedirectParams(callbackUrl, csrfToken);
      return response.redirect(callbackUrl.toString());
    }

    try {
      const loginResult = await this.authService.login(request.user);
      this.setRefreshCookie(response, loginResult.refresh_token);

      const callbackUrl = new URL('/auth/google/callback', frontendUrl);
      callbackUrl.searchParams.set('token', loginResult.access_token);
      this.addCsrfRedirectParams(callbackUrl, csrfToken);
      return response.redirect(callbackUrl.toString());
    } catch {
      const errorUrl = new URL('/auth/google/callback', frontendUrl);
      errorUrl.searchParams.set('error', 'google_auth_failed');
      return response.redirect(errorUrl.toString());
    }
  }

  private getFrontendUrl(): string {
    const corsOrigins = process.env.CORS_ORIGINS || '';
    const firstOrigin = corsOrigins.split(',')[0]?.trim();
    return firstOrigin || 'http://localhost:8080';
  }

  @Post('refresh')
  @ApiOperation({
    summary: 'Refresh access token',
    description:
      'Returns a new access token plus CSRF token for authenticated API calls. The refresh cookie remains valid until its JWT expiry or explicit invalidation.',
  })
  @ApiCookieAuth(REFRESH_TOKEN_COOKIE)
  @ApiCreatedResponse({
    description: 'Access token refreshed successfully',
    schema: {
      example: {
        access_token: 'eyJhbGciOi...access',
        csrf_token: 'nonce.signature',
        csrf_header: CSRF_HEADER_NAME,
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
    const csrfToken = ensureCsrfCookie(request, response);

    return {
      access_token: refreshedTokens.access_token,
      csrf_token: csrfToken,
      csrf_header: CSRF_HEADER_NAME,
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
    clearCsrfCookie(response);
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
    clearCsrfCookie(response);
    return {
      message: 'Logged out successfully.',
      fcmTokenCleared: result.fcmTokenCleared,
    };
  }
}
