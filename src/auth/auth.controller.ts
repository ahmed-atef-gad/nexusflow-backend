import { Controller, Post, Body, Request, UseGuards, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterUserDto } from './dto/register-user.dto';
// We will create LocalAuthGuard soon. For login, we'll just use a basic DTO for now.
import { LoginUserDto } from './dto/login-user.dto';
import { ApiBadRequestResponse, ApiCreatedResponse } from '@nestjs/swagger';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @ApiCreatedResponse({ description: 'Created user as response' })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  async register(@Body() registerUserDto: RegisterUserDto) {
    return this.authService.register(registerUserDto);
  }

  @Post('login')
  @ApiCreatedResponse({ description: 'Access Token' })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  async login(@Body() loginUserDto: LoginUserDto) {
    // First, validate the user
    const user = await this.authService.validateUser(
      loginUserDto.email,
      loginUserDto.password,
    );
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    // If valid, return a JWT
    return this.authService.login(user);
  }
}