import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  getUserIdFromRequest,
  type AuthenticatedRequest,
} from 'src/auth/utils/auth.util';
import { AuthGuard } from 'src/guards/auth/auth.guard';
import { RegisterNotificationDeviceDto } from './dto/register-notification-device.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller('v1/notifications/devices')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @ApiOperation({
    summary: 'Register or update mobile FCM token',
    description:
      'Upserts device token by authenticated user and deviceId (device-level registration, not project-level). Reactivates token if it was invalidated earlier.',
  })
  @ApiBody({
    type: RegisterNotificationDeviceDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Device token registered successfully',
    schema: {
      example: {
        id: '6802ec3f7fd4db8af143dcf1',
        deviceId: 'a1b2c3d4-device-id',
        platform: 'android',
        appVersion: '1.0.0',
        locale: 'en-US',
        registeredAt: '2026-04-27T10:00:00.000Z',
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing user token',
  })
  @Post('register')
  async registerDevice(
    @Req() req: AuthenticatedRequest,
    @Body() body: RegisterNotificationDeviceDto
  ) {
    const userId = getUserIdFromRequest(req);
    return this.notificationsService.registerDeviceToken(userId, body);
  }
}
