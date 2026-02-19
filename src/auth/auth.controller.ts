import {
  Controller,
  Post,
  Body,
  UnauthorizedException,
  Res,
  Get,
  Req,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterUserDto } from './dto/register-user.dto';
// We will create LocalAuthGuard soon. For login, we'll just use a basic DTO for now.
import { LoginUserDto } from './dto/login-user.dto';
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
   * Get the authenticated user's profile.
   *
   * @route GET /auth/profile
   * @auth Cookie `jwt` (HttpOnly)
   * @returns User profile with a fresh MQTT password
   */
  @ApiOperation({
    summary: 'Get current user profile',
    description:
      'Returns the authenticated user profile based on the `jwt` cookie and refreshes the MQTT password.',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile fetched successfully',
    schema: {
      example: {
        _id: '507f1f77bcf86cd799439011',
        username: 'john_doe',
        email: 'john@example.com',
        roles: ['User'],
        is_active: true,
        email_verified: false,
        mqtt_password: 'a1b2c3d4e5f6g7h8',
        createdAt: '2024-02-10T10:30:00Z',
        updatedAt: '2024-02-10T10:30:00Z',
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing token',
    schema: {
      example: {
        statusCode: 401,
        message: 'Invalid token',
        error: 'Unauthorized',
      },
    },
  })
  @Get('profile')
  async getProfile(@Req() request: Request) {
    const token = request.cookies['jwt'];
    if (!token) {
      throw new UnauthorizedException('No token found');
    }
    const userProfile = await this.authService.getProfile(token);
    return userProfile;
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
