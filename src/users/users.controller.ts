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
  UnauthorizedException,
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

@UseGuards(AuthGuard)
@Controller('users')
export class UsersController {
  constructor(private userService: UsersService) {}
  @Get('profile')
  async getProfile(@Req() req) {
    const user = req.user;

    if (!user.sub) {
      throw new UnauthorizedException('User not authenticated');
    }

    return {
      id: user.sub,
      email: user.email,
      username: user.username,
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
