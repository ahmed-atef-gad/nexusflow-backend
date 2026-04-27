import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { SetupService } from './setup.service';
import { SetupPayload } from './types/flow.types';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiCookieAuth,
  ApiBody,
  ApiSecurity,
  ApiHeader,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard } from '../guards/auth/auth.guard';
import { Setup } from './schemas/setup.schema';
import { DeviceAuthGuard } from '../guards/device-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../guards/auth/roles.guard';
import { Role } from '../users/enums/role.enum';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';

/**
 * SetupController
 *
 * Handles all endpoints related to device configuration setups.
 * Manages CRUD operations for setup documents and device synchronization.
 */
@ApiTags('Setups (Device Configuration)')
@Controller('setups')
export class SetupController {
  constructor(private readonly setupService: SetupService) {}

  /**
   * Create a new setup document manually
   *
   * @param body - The setup payload containing configuration data
   * @returns The created setup document
   */
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @ApiCookieAuth('jwt')
  @ApiOperation({ summary: 'Create a Setup document manually' })
  @ApiBody({ type: SetupPayload })
  @ApiResponse({ status: 201, description: 'Setup created', type: Setup })
  @Post()
  create(@Body() body: SetupPayload) {
    return this.setupService.create(body);
  }

  /**
   * Retrieve all setup documents from the database
   *
   * @returns Array of all setup documents
   */
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @ApiCookieAuth('jwt')
  @ApiOperation({ summary: 'Get all setups' })
  @ApiResponse({ status: 200 })
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
  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.setupService.findAll(query);
  }

  /**
   * Retrieve a specific setup document by its ID
   *
   * @param id - The setup document ID
   * @returns The setup document matching the provided ID
   */
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @ApiCookieAuth('jwt')
  @ApiOperation({ summary: 'Get setup by ID' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: Setup })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.setupService.findOne(id);
  }

  /**
   * Retrieve a setup document by the associated Flow ID
   *
   * @param flowId - The flow document ID
   * @returns The setup document linked to the specified flow
   */
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @ApiCookieAuth('jwt')
  @ApiOperation({ summary: 'Get setup by Flow ID' })
  @ApiParam({ name: 'flowId' })
  @ApiResponse({ status: 200, type: Setup })
  @Get('flow/:flowId')
  findByFlowId(@Param('flowId') flowId: string) {
    return this.setupService.findByFlowId(flowId);
  }

  /**
   * Update an existing setup document
   *
   * @param id - The setup document ID to update
   * @param body - Partial setup payload with fields to update
   * @returns The updated setup document
   */
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @ApiCookieAuth('jwt')
  @ApiOperation({ summary: 'Update setup by ID' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: SetupPayload })
  @ApiResponse({ status: 200, type: Setup })
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Partial<SetupPayload>) {
    return this.setupService.update(id, body);
  }

  /**
   * Delete a setup document
   *
   * @param id - The setup document ID to delete
   */
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @ApiCookieAuth('jwt')
  @ApiOperation({ summary: 'Delete setup by ID' })
  @ApiParam({ name: 'id' })
  @ApiResponse({
    status: 200,
    description: 'Setup deleted successfully',
    schema: { example: { acknowledged: true, deletedCount: 1 } },
  })
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.setupService.delete(id);
  }

  /**
   * Device Configuration Synchronization Endpoint
   *
   * Allows authenticated IoT devices to fetch their configuration setup.
   * This endpoint is protected by DeviceAuthGuard which validates the device token.
   *
   * @route GET /setups/device/sync
   * @auth DeviceAuthGuard (Bearer token in Authorization header)
   * @param req - The request object containing authenticated device information
   * @returns { message: string, device: { macAddress: string } }
   *
   * @example
   * // Request
   * GET /setups/device/sync
   * Headers: Authorization: Bearer <device-token>
   *
   * // Response (200 OK)
   * {
   *   "message": "Here is your config",
   *   "device": {
   *     "macAddress": "AA:BB:CC:DD:EE:FF"
   *   }
   * }
   *
   * @throws UnauthorizedException (401) - If device token is missing or invalid
   * @throws UnauthorizedException (401) - If device token is expired or revoked
   *
   * @security DeviceAuthGuard
   * Security: Requires valid device token in Bearer format
   */
  @ApiOperation({
    summary: 'Sync device configuration',
    description:
      'Retrieves the setup configuration for an authenticated device. The device must be registered and have a valid token.',
  })
  @ApiSecurity('device-token')
  @ApiHeader({
    name: 'Authorization',
    description: 'Device Bearer token (format: Bearer <tokenId.secret>)',
    required: true,
    example: 'Bearer 550e8400-e29b-41d4-a716-446655440000.a1b2c3d4e5f6...',
  })
  @ApiResponse({
    status: 200,
    description: 'Device configuration retrieved successfully',
    schema: {
      example: {
        message: 'Here is your config',
        device: {
          macAddress: 'AA:BB:CC:DD:EE:FF',
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing device token',
    schema: {
      example: {
        statusCode: 401,
        message: 'Invalid or Revoked Device Token',
        error: 'Unauthorized',
      },
    },
  })
  @UseGuards(DeviceAuthGuard)
  @Get('device/sync')
  async syncDevice(@Req() req) {
    // Extract device information attached by DeviceAuthGuard
    const device = req.device;
    const setupConfig = await this.setupService.findForDeviceContext(device);

    return {
      message: setupConfig
        ? 'Here is your config'
        : 'No config found for this device',
      device: { macAddress: device.macAddress },
      setup: setupConfig?.elements ?? null,
    };
  }
}
