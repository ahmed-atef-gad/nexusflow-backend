import { Body, Controller, Delete, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../gaurds/auth/auth.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UsersService } from './users.service';
import { ApiBadRequestResponse, ApiCreatedResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';

@UseGuards(AuthGuard)
@Controller('users')

export class UsersController {
     constructor(private  userService: UsersService) {}
    @Get('profile')
    async getProfile(@Request() req) {
        return "This is the profile of user";
    }
    @ApiCreatedResponse({ description: 'Created user as response' })
    @ApiBadRequestResponse({ description: 'Bad Request' })
    @ApiUnauthorizedResponse({ description: 'Unauthorized' })
    @Post()
    async createUser(@Body() createUserDto: CreateUserDto) {
        return this.userService.create(createUserDto);
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


