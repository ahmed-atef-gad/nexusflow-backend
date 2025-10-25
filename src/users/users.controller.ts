import { Body, Controller, Delete, Get, Param, Post, Request, UseGuards, Patch } from '@nestjs/common';
import { AuthGuard } from '../gaurds/auth/auth.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';
import { ApiBadRequestResponse, ApiCreatedResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Roles } from './../auth/decorators/roles.decorator';
import { RolesGuard } from '../gaurds/auth/roles.guard';
import { Role } from './enums/role.enum';
import { OwnerGuard } from '../gaurds/auth/owner.guard';
import { IsOwner } from 'src/auth/decorators/owner.decorator';

@UseGuards(AuthGuard, RolesGuard, OwnerGuard)
@Controller('users')

export class UsersController {
    constructor(private userService: UsersService) { }
    @Get('profile')
    //@IsOwner()
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
    @ApiCreatedResponse({ description: 'Updated user as response' })
    @ApiBadRequestResponse({ description: 'Bad Request' })
    @ApiUnauthorizedResponse({ description: 'Unauthorized' })
    @Patch(':id')
    async updateUser(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
        return this.userService.update(id, updateUserDto);
    }
    @ApiCreatedResponse({ description: 'show all users' })
    @ApiBadRequestResponse({ description: 'Not Valid ID' })
    @ApiUnauthorizedResponse({ description: 'Unauthorized' })
    @Get()
    //@Roles(Role.Admin)

    async getUsers() {
        return this.userService.findAll();
    }
    @ApiCreatedResponse({ description: 'Get user by ID' })
    @ApiBadRequestResponse({ description: 'Not Valid ID' })
    @ApiUnauthorizedResponse({ description: 'Unauthorized' })
    @Get(':id')
    @IsOwner()
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


