import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
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
import { NotificationHistoryQueryDto } from './dto/notification-history-query.dto';

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller('v1/notifications')
export class NotificationsActionsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @ApiOperation({
    summary: 'Get notification history for the authenticated user',
    description:
      'Returns notifications sorted by sent_at descending using page-based pagination.',
  })
  @ApiQuery({
    name: 'since',
    required: false,
    description: 'ISO timestamp lower bound',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of records (default 50, max 100)',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number (default 1)',
  })
  @ApiResponse({
    status: 200,
    description: 'Notification history fetched successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing user token',
  })
  @Get('history')
  async getHistory(
    @Req() req: AuthenticatedRequest,
    @Query() query: NotificationHistoryQueryDto
  ) {
    const userId = getUserIdFromRequest(req);
    return this.notificationsService.getNotificationHistory(userId, query);
  }

  @ApiOperation({
    summary: 'Mark notification as handled',
    description:
      'Marks the notification as handled and acknowledges the active incident.',
  })
  @ApiParam({ name: 'notificationId', description: 'Notification identifier' })
  @ApiResponse({
    status: 200,
    description: 'Notification handled successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing user token',
  })
  @Post(':notificationId/handled')
  async markHandled(
    @Req() req: AuthenticatedRequest,
    @Param('notificationId') notificationId: string
  ) {
    const userId = getUserIdFromRequest(req);
    return this.notificationsService.markNotificationHandled(
      userId,
      notificationId
    );
  }
}
