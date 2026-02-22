import { Body, Controller, Get, Req, UseGuards, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../gaurds/auth/auth.guard';
import { DevicesService } from './devices.service';
import { RegisterDeviceWithCodeDto } from './dto/register-device-with-code.dto';

@ApiTags('Device Registration')
@Controller('devices')
export class DeviceRegistrationController {
  constructor(private readonly devicesService: DevicesService) {}

  @ApiOperation({
    summary: 'Generate one-time device registration code',
    description:
      'Generates a short-lived code tied to the authenticated user. Devices can use this code to register themselves to this user.',
  })
  @ApiResponse({
    status: 201,
    description: 'Registration code created successfully',
    schema: {
      example: {
        code: 'A1B2C3D4',
        expiresAt: '2026-02-22T12:30:00.000Z',
        expiresInMinutes: 10,
      },
    },
  })
  @UseGuards(AuthGuard)
  @Get('registration-code')
  generateRegistrationCode(@Req() req: { user: { sub: string } }) {
    return this.devicesService.createRegistrationCode(req.user.sub, 10);
  }

  @ApiOperation({
    summary: 'Register device with one-time code',
    description:
      'Used by ESP/device firmware to register a device using user-generated code plus device details.',
  })
  @ApiBody({
    description: 'Device registration with code data',
    type: RegisterDeviceWithCodeDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Device registered successfully',
    schema: {
      example: {
        _id: '507f1f77bcf86cd799439011',
        macAddress: 'AA:BB:CC:DD:EE:FF',
        name: 'Kitchen Sensor',
        ownerId: '507f1f77bcf86cd799439012',
        status: 'active',
        createdAt: '2024-02-22T12:30:00Z',
        updatedAt: '2024-02-22T12:30:00Z',
        token: {
          accessToken:
            '550e8400-e29b-41d4-a716-446655440000.a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
          deviceId: '507f1f77bcf86cd799439011',
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or expired registration code',
  })
  @Post('verify-registration-code')
  async registerWithCode(@Body() body: RegisterDeviceWithCodeDto) {
    return this.devicesService.registerDeviceWithCode(
      body.code,
      body.macAddress,
      body.name,
      body.mqtt_pass
    );
  }
}
