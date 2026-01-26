import {
  Controller,
  Post,
  Body,
  UnauthorizedException,
  Res,
  Get,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterUserDto } from './dto/register-user.dto';
// We will create LocalAuthGuard soon. For login, we'll just use a basic DTO for now.
import { LoginUserDto } from './dto/login-user.dto';
import { ApiBadRequestResponse, ApiCreatedResponse } from '@nestjs/swagger';
import { User } from 'src/users/schemas/user.schema';
import type { Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Get('profile') async getProfile(
    @Res({ passthrough: true }) response: Response
  ) {
    const token = response.req.cookies['jwt'];
    if (!token) {
      throw new UnauthorizedException('No token found');
    }
    const userProfile = await this.authService.getProfile(token);
    return userProfile;
  }

  @Post('register')
  @ApiCreatedResponse({ description: 'Created user as response' })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  async register(
    @Res({ passthrough: true }) response: Response,
    @Body() registerUserDto: RegisterUserDto
  ) {
    const user = await this.authService.register(registerUserDto);
    const token = await this.authService.login(user);
    // Set token in HttpOnly cookie
    response.cookie('jwt', token.access_token, {
      httpOnly: true,
      maxAge: 86400000, // 1 day
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    });
    return { message: 'Registration successful' };
  }

  @Post('login')
  @ApiCreatedResponse({
    description: 'Login successful, JWT set in HTTP-only cookie',
  })
  @ApiBadRequestResponse({ description: 'Bad Request' })
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
    const token = await this.authService.login(user);

    // Set token in HttpOnly cookie
    response.cookie('jwt', token.access_token, {
      httpOnly: true,
      maxAge: 86400000, // 1 day
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    });
    return { message: 'Login successful' };
  }
  @Post('logout')
  async logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('jwt', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    });
    return { message: 'Logout successful' };
  }
}
