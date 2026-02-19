import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Request,
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
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiBody,
} from '@nestjs/swagger';
import { Roles } from './../auth/decorators/roles.decorator';
import { RolesGuard } from '../gaurds/auth/roles.guard';
import { Role } from './enums/role.enum';
import { OwnerGuard } from '../gaurds/auth/owner.guard';

/**
 * UsersController
 *
 * Admin endpoints for managing users, plus utility endpoints for the
 * authenticated user (profile and MQTT OTP).
 */
@UseGuards(AuthGuard, RolesGuard, OwnerGuard)
@ApiTags('Users Management')
@ApiCookieAuth('jwt')
@Controller('users')
export class UsersController {
  constructor(private userService: UsersService) {}

  /**
   * Generate a one-time MQTT password for the current user.
   *
   * @route GET /users/mqtt-otp
   * @auth Cookie `jwt` (HttpOnly)
   */
  @ApiOperation({
    summary: 'Generate MQTT OTP',
    description:
      'Generates a one-time MQTT password for the authenticated user. The password becomes invalid after the first successful MQTT authentication.',
  })
  @ApiOkResponse({
    description: 'MQTT OTP generated successfully',
    schema: {
      example: {
        mqtt_password: 'a1b2c3d4e5f6g7h8',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid or missing token' })
  @Get('mqtt-otp')
  @UseGuards(AuthGuard)
  async mqttOTP(@Request() req) {
    const user = req.user;
    if (!user.sub) {
      throw new UnauthorizedException('User not authenticated');
    }
    const plainMqttPass = await this.userService.generateMqttOTP(user.sub);
    return {
      mqtt_password: plainMqttPass,
    };
  }

  /**
   * Get the authenticated user's basic profile.
   *
   * @route GET /users/profile
   * @auth Cookie `jwt` (HttpOnly)
   */
  @ApiOperation({
    summary: 'Get current user profile',
    description: 'Returns the authenticated user basic profile details.',
  })
  @ApiOkResponse({
    description: 'User profile returned',
    schema: {
      example: {
        id: '507f1f77bcf86cd799439011',
        email: 'john@example.com',
        username: 'john_doe',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid or missing token' })
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

  /**
   * Create a new user (Admin only).
   *
   * @route POST /users
   * @auth Cookie `jwt` (HttpOnly)
   */
  @Post()
  @ApiOperation({
    summary: 'Create a user (Admin)',
    description:
      'Creates a new user with optional admin fields such as roles and activation flags.',
  })
  @ApiBody({ type: CreateUserDto })
  @ApiCreatedResponse({
    description: 'User created successfully',
    schema: {
      example: {
        _id: '507f1f77bcf86cd799439011',
        username: 'john_doe',
        email: 'john@example.com',
        roles: ['User'],
        is_active: true,
        email_verified: false,
        createdAt: '2024-02-10T10:30:00Z',
        updatedAt: '2024-02-10T10:30:00Z',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Bad Request - Validation error' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid or missing token' })
  @ApiForbiddenResponse({ description: 'Forbidden - Admin role required' })
  @Roles(Role.Admin)
  async createUser(@Body() createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }

  /**
   * Update a user (Admin only).
   *
   * @route PATCH /users/:id
   */
  @Patch(':id')
  @ApiOperation({
    summary: 'Update a user (Admin)',
    description: 'Updates user fields by ID. Password changes are re-hashed.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB ID of the user',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiBody({ type: UpdateUserDto })
  @ApiOkResponse({
    description: 'User updated successfully',
    schema: {
      example: {
        _id: '507f1f77bcf86cd799439011',
        username: 'john_doe',
        email: 'john@example.com',
        roles: ['User'],
        is_active: true,
        email_verified: false,
        updatedAt: '2024-02-15T09:10:00Z',
      },
    },
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiBadRequestResponse({ description: 'Bad Request - Validation error' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid or missing token' })
  @ApiForbiddenResponse({ description: 'Forbidden - Admin role required' })
  @Roles(Role.Admin)
  async updateUser(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto
  ) {
    return this.userService.update(id, updateUserDto);
  }

  /**
   * List all users (Admin only).
   *
   * @route GET /users
   */
  @Get()
  @ApiOperation({
    summary: 'List all users (Admin)',
    description: 'Returns a list of all users in the system.',
  })
  @ApiOkResponse({
    description: 'Users fetched successfully',
    schema: {
      example: [
        {
          _id: '507f1f77bcf86cd799439011',
          username: 'john_doe',
          email: 'john@example.com',
          roles: ['User'],
          is_active: true,
          email_verified: false,
        },
      ],
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid or missing token' })
  @ApiForbiddenResponse({ description: 'Forbidden - Admin role required' })
  @Roles(Role.Admin)
  async getUsers() {
    return this.userService.findAll();
  }

  /**
   * Get a user by ID (Admin only).
   *
   * @route GET /users/:id
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get user by ID (Admin)',
    description: 'Fetches a user by MongoDB ID.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB ID of the user',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiOkResponse({
    description: 'User fetched successfully',
    schema: {
      example: {
        _id: '507f1f77bcf86cd799439011',
        username: 'john_doe',
        email: 'john@example.com',
        roles: ['User'],
        is_active: true,
        email_verified: false,
      },
    },
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid or missing token' })
  @ApiForbiddenResponse({ description: 'Forbidden - Admin role required' })
  @Roles(Role.Admin)
  async getUserById(@Param('id') id: string) {
    return this.userService.getUserById(id);
  }

  /**
   * Delete a user by ID (Admin only).
   *
   * @route DELETE /users/:id
   */
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete user (Admin)',
    description: 'Deletes a user by MongoDB ID.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB ID of the user',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiOkResponse({
    description: 'User deleted successfully',
    schema: {
      example: {
        deleted: true,
      },
    },
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid or missing token' })
  @ApiForbiddenResponse({ description: 'Forbidden - Admin role required' })
  @Roles(Role.Admin)
  @UseGuards(RolesGuard)
  async deleteUser(@Param('id') id: string) {
    return this.userService.delete(id);
  }
}
