import {
  Controller,
  Post,
  Body,
  UnauthorizedException,
  Res,
  Req,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterUserDto } from './dto/register-user.dto';
// We will create LocalAuthGuard soon. For login, we'll just use a basic DTO for now.
import { LoginUserDto } from './dto/login-user.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
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
import { User } from 'src/users/schemas/user.schema';
import type { Response, Request } from 'express';

/**
 * Authentication endpoints for registration, login, profile retrieval, and logout.
 * Uses an HttpOnly `jwt` cookie for session management.
 */
@ApiTags('Authentication')
@ApiCookieAuth('jwt')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

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
      'Creates a new user account and sets the `jwt` cookie on success. Returns MQTT credentials for broker access.',
  })
  @ApiBody({ type: RegisterUserDto })
  @ApiCreatedResponse({
    description: 'Registration successful, JWT set in HTTP-only cookie',
    schema: {
      example: {
        message: 'Registration successful',
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
    // Set token in HttpOnly cookie
    response.cookie('jwt', loginResult.access_token, {
      httpOnly: true,
      maxAge: 604800000, // 7 days
      path: '/',
      secure: true,
      sameSite: 'none',
    });
    return {
      message: 'Registration successful',
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
      'Validates credentials, sets the `jwt` cookie, and returns MQTT credentials.',
  })
  @ApiBody({ type: LoginUserDto })
  @ApiCreatedResponse({
    description: 'Login successful, JWT set in HTTP-only cookie',
    schema: {
      example: {
        message: 'Login successful',
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
    const user = (await this.authService.validateUser(
      loginUserDto.email,
      loginUserDto.password
    )) as User;
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    // If valid, return a JWT
    const loginResult = await this.authService.login(user);

    // Set token in HttpOnly cookie
    response.cookie('jwt', loginResult.access_token, {
      httpOnly: true,
      maxAge: 604800000, // 7 days
      path: '/',
      secure: true,
      sameSite: 'none',
    });
    return {
      message: 'Login successful',
      mqtt: {
        username: loginResult.mqtt_username,
        password: loginResult.mqtt_password,
        clientId: loginResult.mqtt_username,
      },
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
    response.clearCookie('jwt', {
      httpOnly: true,
      path: '/',
      secure: true,
      sameSite: 'none',
    });
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
      'Clears the `jwt` cookie and invalidates existing tokens by bumping token version.',
  })
  @ApiResponse({
    status: 200,
    description: 'Logout successful',
    schema: {
      example: {
        message: 'Logout successful',
      },
    },
  })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const token = request.cookies?.['jwt'];
    await this.authService.logout(token);
    response.clearCookie('jwt', {
      httpOnly: true,
      path: '/',
      secure: true,
      sameSite: 'none',
    });
    return { message: 'Logout successful' };
  }
}
