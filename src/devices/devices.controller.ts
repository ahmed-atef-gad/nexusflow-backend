import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  Param,
  Delete,
} from '@nestjs/common';
import { DevicesService } from './devices.service';
import { AuthGuard } from '../gaurds/auth/auth.guard';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiBody,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';

/**
 * DevicesController
 *
 * Manages device registration, token generation, and token revocation.
 * All endpoints require user authentication via AuthGuard.
 * Used by mobile applications to manage IoT devices.
 */
@ApiTags('Devices Management (Mobile App)')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  /**
   * Register a new ESP device by MAC address
   *
   * @route POST /devices/register
   * @auth AuthGuard (User access token required)
   * @param req - The request object containing authenticated user
   * @param body - Registration payload with MAC address and optional name
   * @returns Device object with ID, MAC address, name, and status
   *
   * @example
   * // Request
   * POST /devices/register
   * Headers: Authorization: Bearer <user-access-token>
   * Body: { "macAddress": "AA:BB:CC:DD:EE:FF", "name": "Living Room Sensor" }
   *
   * // Response (201 Created)
   * {
   *   "_id": "507f1f77bcf86cd799439011",
   *   "macAddress": "AA:BB:CC:DD:EE:FF",
   *   "name": "Living Room Sensor",
   *   "ownerId": "507f1f77bcf86cd799439012",
   *   "status": "active",
   *   "createdAt": "2024-02-10T10:30:00Z",
   *   "updatedAt": "2024-02-10T10:30:00Z"
   * }
   */
  @ApiOperation({
    summary: 'Register a new ESP device by MAC Address',
    description:
      'Registers a new IoT device for the authenticated user. The device is identified by its MAC address and can optionally be given a friendly name.',
  })
  @ApiBody({
    description: 'Device registration data',
    schema: {
      type: 'object',
      required: ['macAddress'],
      properties: {
        macAddress: {
          type: 'string',
          description: 'MAC address of the device (e.g., AA:BB:CC:DD:EE:FF)',
          example: 'AA:BB:CC:DD:EE:FF',
        },
        name: {
          type: 'string',
          description: 'Optional friendly name for the device',
          example: 'Living Room Sensor',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Device registered successfully',
    schema: {
      example: {
        _id: '507f1f77bcf86cd799439011',
        macAddress: 'AA:BB:CC:DD:EE:FF',
        name: 'Living Room Sensor',
        ownerId: '507f1f77bcf86cd799439012',
        status: 'active',
        createdAt: '2024-02-10T10:30:00Z',
        updatedAt: '2024-02-10T10:30:00Z',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Device already registered to another user',
    schema: {
      example: {
        statusCode: 400,
        message: 'Device already registered to another user',
        error: 'Bad Request',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing user token',
  })
  @Post('register')
  async register(
    @Req() req,
    @Body() body: { macAddress: string; name?: string }
  ) {
    return this.devicesService.registerDevice(
      req.user.sub,
      body.macAddress,
      body.name
    );
  }

  /**
   * Generate a long-lived authentication token for the device
   *
   * @route POST /devices/:id/token
   * @auth AuthGuard (User access token required)
   * @param deviceId - The MongoDB ID of the device
   * @returns Token object containing accessToken, deviceId, and macAddress
   *
   * @example
   * // Request
   * POST /devices/507f1f77bcf86cd799439011/token
   * Headers: Authorization: Bearer <user-access-token>
   *
   * // Response (201 Created)
   * {
   *   "accessToken": "550e8400-e29b-41d4-a716-446655440000.a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
   *   "deviceId": "507f1f77bcf86cd799439011",
   *   "macAddress": "AA:BB:CC:DD:EE:FF"
   * }
   *
   * @note The token is returned only once. Store it securely on the device.
   * @note Token format: <tokenId>.<secret> where tokenId is a UUID and secret is a hex string
   * @note Token expires in 1 year
   */
  @ApiOperation({
    summary: 'Generate a long-lived token for the device',
    description:
      'Generates an authentication token that the device can use to communicate with the API. The token follows the format: <tokenId>.<secret>. Store this token securely on the device as it will only be shown once.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB ID of the device',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiResponse({
    status: 201,
    description: 'Token generated successfully',
    schema: {
      example: {
        accessToken:
          '550e8400-e29b-41d4-a716-446655440000.a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
        deviceId: '507f1f77bcf86cd799439011',
        macAddress: 'AA:BB:CC:DD:EE:FF',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found - Device does not exist',
    schema: {
      example: {
        statusCode: 404,
        message: 'Device not found',
        error: 'Not Found',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing user token',
  })
  @Post(':id/token')
  async generateToken(@Param('id') deviceId: string) {
    // TODO: Verify user owns this device before generating token
    return this.devicesService.generateDeviceToken(deviceId);
  }

  /**
   * Revoke a device token
   *
   * @route DELETE /devices/token/:tokenId
   * @auth AuthGuard (User access token required)
   * @param tokenId - The public token ID to revoke
   * @returns Acknowledgment of token revocation
   *
   * @example
   * // Request
   * DELETE /devices/token/550e8400-e29b-41d4-a716-446655440000
   * Headers: Authorization: Bearer <user-access-token>
   *
   * // Response (200 OK)
   * {
   *   "acknowledged": true,
   *   "modifiedCount": 1
   * }
   *
   * @note Once revoked, the token cannot be used for device authentication
   * @note Revoked tokens are handled by DeviceAuthGuard in protected endpoints
   */
  @ApiOperation({
    summary: 'Revoke a device token',
    description:
      'Revokes a device token by marking it as revoked. The device will no longer be able to authenticate using this token.',
  })
  @ApiParam({
    name: 'tokenId',
    description: 'Public token ID (UUID) to revoke',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Token revoked successfully',
    schema: {
      example: {
        acknowledged: true,
        modifiedCount: 1,
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found - Token does not exist',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing user token',
  })
  @Delete('token/:tokenId')
  async revokeToken(@Param('tokenId') tokenId: string) {
    return this.devicesService.revokeToken(tokenId);
  }
}
