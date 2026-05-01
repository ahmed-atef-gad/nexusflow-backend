import { Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  getUserIdFromRequest,
  type AuthenticatedRequest,
} from 'src/auth/utils/auth.util';
import { AuthGuard } from 'src/guards/auth/auth.guard';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiCookieAuth('jwt')
@UseGuards(AuthGuard)
@Controller('v1/notifications/alert-history')
export class NotificationsAlertHandshakeController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @ApiOperation({
    summary: 'Mark alert notification as received on mobile device',
  })
  @ApiParam({
    name: 'historyId',
    description: 'Alert history identifier from push payload',
  })
  @ApiResponse({
    status: 200,
    description: 'Alert notification receive status updated successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing user token',
  })
  @Post(':historyId/received')
  async markNotificationReceived(
    @Req() req: AuthenticatedRequest,
    @Param('historyId') historyId: string
  ) {
    const userId = getUserIdFromRequest(req);
    return this.notificationsService.markAlertNotificationReceived(
      userId,
      historyId
    );
  }

  @ApiOperation({
    summary: 'Mark alert notification as handled by user interaction',
  })
  @ApiParam({
    name: 'historyId',
    description: 'Alert history identifier from push payload',
  })
  @ApiResponse({
    status: 200,
    description: 'Alert notification handled status updated successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing user token',
  })
  @Post(':historyId/handled')
  async markNotificationHandled(
    @Req() req: AuthenticatedRequest,
    @Param('historyId') historyId: string
  ) {
    const userId = getUserIdFromRequest(req);
    return this.notificationsService.markAlertNotificationHandled(
      userId,
      historyId
    );
  }
}
