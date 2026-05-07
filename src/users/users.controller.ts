import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Request,
  Req,
  UseGuards,
  Patch,
} from '@nestjs/common';
import { AuthGuard } from '../guards/auth/auth.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { Roles } from './../auth/decorators/roles.decorator';
import { RolesGuard } from '../guards/auth/roles.guard';
import { Role } from './enums/role.enum';
import { OwnerGuard } from '../guards/auth/owner.guard';
import type { AuthenticatedRequest } from '../auth/utils/auth.util';
import { getUserIdFromRequest } from '../auth/utils/auth.util';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
/**
 * UsersController
 *
 * Admin endpoints for managing users, plus utility endpoints for the
 * authenticated user (profile and MQTT OTP).
 */
@UseGuards(AuthGuard, RolesGuard, OwnerGuard)
@ApiTags('Users Management')
@ApiBearerAuth('access-token')
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
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing token',
  })
  @Get('mqtt-otp')
  @UseGuards(AuthGuard)
  async mqttOTP(@Request() req: AuthenticatedRequest) {
    const userId = getUserIdFromRequest(req);
    const plainMqttPass = await this.userService.generateMqttOTP(userId);
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
        isActive: true,
        roles: ['User'],
        isEmailVerified: false,
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing token',
  })
  @Get('profile')
  getProfile(@Req() req: AuthenticatedRequest) {
    const userId = getUserIdFromRequest(req);
    const user = req.user;

    return {
      id: userId,
      email: user?.email,
      username: user?.username,
      roles: user?.roles,
      isEmailVerified: user?.isEmailVerified,
      isActive: user?.isActive,
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
      'Creates a new user with optional admin fields such as roles and activation flags. Admin only: accessible by Admin or Owner.',
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
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing token',
  })
  @ApiForbiddenResponse({ description: 'Forbidden - Admin role required' })
  @Roles(Role.Admin)
  async createUser(
    @Req() req: AuthenticatedRequest,
    @Body() createUserDto: CreateUserDto
  ) {
    const isOwner = req.user?.roles?.includes(Role.Owner) ?? false;
    if (createUserDto.roles !== undefined && !isOwner) {
      throw new ForbiddenException('Only owner can set user roles');
    }

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
    description:
      'Updates user fields by ID. Password changes are re-hashed. Admin only: accessible by Admin or Owner.',
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
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing token',
  })
  @ApiForbiddenResponse({ description: 'Forbidden - Admin role required' })
  @Roles(Role.Admin)
  async updateUser(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto
  ) {
    const isOwner = req.user?.roles?.includes(Role.Owner) ?? false;
    if (updateUserDto.roles !== undefined && !isOwner) {
      throw new ForbiddenException('Only owner can change user roles');
    }

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
    description:
      'Returns a list of all users in the system. Admin only: accessible by Admin or Owner.',
  })
  @ApiOkResponse({
    description: 'Users fetched successfully',
    schema: {
      example: {
        data: [
          {
            _id: '507f1f77bcf86cd799439011',
            username: 'john_doe',
            email: 'john@example.com',
            roles: ['user'],
            is_active: true,
            email_verified: false,
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      },
    },
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number, starts from 1',
    example: '1',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Items per page, max 100',
    example: '10',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Case-insensitive search against username and email',
    example: 'john',
  })
  @ApiQuery({
    name: 'role',
    required: false,
    description: 'Filter users by role',
    enum: Role,
  })
  @ApiQuery({
    name: 'is_active',
    required: false,
    description: 'Filter by active status',
    enum: ['true', 'false'],
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing token',
  })
  @ApiForbiddenResponse({ description: 'Forbidden - Admin role required' })
  @Roles(Role.Admin)
  async getUsers(@Query() query: ListUsersQueryDto) {
    return this.userService.findAll(query);
  }

  /**
   * Get a user by ID (Admin only).
   *
   * @route GET /users/:id
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get user by ID (Admin)',
    description:
      'Fetches a user by MongoDB ID. Admin only: accessible by Admin or Owner.',
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
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing token',
  })
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
    description:
      'Deletes a user by MongoDB ID. Admin only: accessible by Admin or Owner.',
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
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing token',
  })
  @ApiForbiddenResponse({ description: 'Forbidden - Admin role required' })
  @Roles(Role.Admin)
  @UseGuards(RolesGuard)
  async deleteUser(@Param('id') id: string) {
    return this.userService.delete(id);
  }
}
