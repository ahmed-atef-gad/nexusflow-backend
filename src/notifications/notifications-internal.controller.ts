import {
  Body,
  Controller,
  Headers,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { TriggerAlertDto } from './dto/trigger-alert.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Internal Notifications')
@Controller('v1/internal/alerts')
export class NotificationsInternalController {
  private readonly logger = new Logger(NotificationsInternalController.name);
  private hasLoggedMissingInternalKeyWarning = false;

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService
  ) {}

  @ApiOperation({
    summary: 'Trigger alert event and send push notifications',
    description:
      'Internal endpoint for alert engine and background services. Persists alert history first, then sends push notifications.',
  })
  @ApiHeader({
    name: 'x-internal-key',
    required: false,
    description:
      'Internal API key. Required if INTERNAL_ALERTS_API_KEY is configured.',
  })
  @ApiBody({
    type: TriggerAlertDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Alert evaluated and push dispatch attempted',
  })
  @Post('trigger')
  async triggerAlert(
    @Headers('x-internal-key') internalKey: string | undefined,
    @Body() body: TriggerAlertDto
  ) {
    this.assertInternalKey(internalKey);
    return this.notificationsService.triggerAlertFromInternal(body);
  }

  private assertInternalKey(incomingKey?: string): void {
    const expectedKey = this.configService.get<string>(
      'INTERNAL_ALERTS_API_KEY'
    );
    if (!expectedKey) {
      if (!this.hasLoggedMissingInternalKeyWarning) {
        this.hasLoggedMissingInternalKeyWarning = true;
        this.logger.warn(
          'INTERNAL_ALERTS_API_KEY is not set. Internal alerts endpoint is currently unprotected.'
        );
      }
      return;
    }

    if (!incomingKey || incomingKey !== expectedKey) {
      throw new UnauthorizedException('Invalid internal alert key');
    }
  }
}
