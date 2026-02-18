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
import { ApiBadRequestResponse, ApiCreatedResponse } from '@nestjs/swagger';
import { User } from 'src/users/schemas/user.schema';
import type { Response, Request } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Get('profile')
  async getProfile(@Req() request: Request) {
    const token = request.cookies['jwt'];
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
  @Post('logout')
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
