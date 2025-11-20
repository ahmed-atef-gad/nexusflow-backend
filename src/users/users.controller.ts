import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  Patch,
} from '@nestjs/common';
import { AuthGuard } from '../gaurds/auth/auth.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

@UseGuards(AuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private userService: UsersService,
    private jwtService: JwtService,
  ) {}
  @Get('profile')
  async getProfile(@Req() req: Request) {
    // extract token from header
    const authHeader = req.headers?.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
      throw new Error('No token provided');
    }
    const rawDecoded: unknown = this.jwtService.decode(token);

    if (
      typeof rawDecoded !== 'object' ||
      rawDecoded === null ||
      !('sub' in rawDecoded)
    ) {
      throw new Error('Invalid token payload');
    }
    const decoded = rawDecoded as { sub: string };
    const userId: string = decoded.sub;
    const user = await this.userService.getUserById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    return {
      id: user._id,
      username: user.username,
      email: user.email,
    };
  }
  @ApiCreatedResponse({ description: 'Created user as response' })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @Post()
  async createUser(@Body() createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }
  @ApiCreatedResponse({ description: 'Updated user as response' })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @Patch(':id')
  async updateUser(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.userService.update(id, updateUserDto);
  }
  @ApiCreatedResponse({ description: 'show all users' })
  @ApiBadRequestResponse({ description: 'Not Valid ID' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @Get()
  async getUsers() {
    return this.userService.findAll();
  }
  @ApiCreatedResponse({ description: 'Get user by ID' })
  @ApiBadRequestResponse({ description: 'Not Valid ID' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @Get(':id')
  async getUserById(@Param('id') id: string) {
    return this.userService.getUserById(id);
  }
  @ApiCreatedResponse({ description: 'Delete user by ID' })
  @ApiBadRequestResponse({ description: 'Not Valid ID' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @Delete(':id')
  async deleteUser(@Param('id') id: string) {
    return this.userService.delete(id);
  }
}
