import { Body, Controller, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { NotificationReceiptsDto } from './dto/notification-receipts.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@Controller('v1/notifications')
export class NotificationsReceiptsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @ApiOperation({
    summary: 'Record notification receipts',
    description:
      'Unauthenticated batch endpoint used by the mobile app to acknowledge delivery timestamps.',
  })
  @ApiBody({ type: NotificationReceiptsDto })
  @ApiResponse({
    status: 200,
    description: 'Notification receipts recorded successfully',
  })
  @Post('receipts')
  async recordReceipts(@Body() body: NotificationReceiptsDto) {
    return this.notificationsService.recordNotificationReceipts(body);
  }
}
