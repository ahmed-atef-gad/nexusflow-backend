import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
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
import { AlertHistoryQueryDto } from './dto/alert-history-query.dto';
import { NotificationsService } from './notifications.service';
import { OwnerGuard } from 'src/guards/auth/owner.guard';
import { IsOwner } from 'src/auth/decorators/owner.decorator';

@ApiTags('Notifications')
@ApiCookieAuth('jwt')
@UseGuards(AuthGuard)
@Controller('v1/flows/:flowId')
export class ProjectAlertHistoryController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @ApiOperation({
    summary: 'Get alert history for a flow',
    description:
      'Returns alerts sorted by occurredAt descending using cursor-based pagination.',
  })
  @ApiParam({
    name: 'flowId',
    description: 'Flow identifier',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of records (default 50, max 100)',
    example: '20',
  })
  @ApiQuery({
    name: 'since',
    required: false,
    description: 'Return alerts from the last N hours (default 24, max 720)',
    example: '24',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Pagination cursor from previous response',
  })
  @ApiQuery({
    name: 'nodeId',
    required: false,
    description: 'Filter by node instance id',
  })
  @ApiQuery({
    name: 'severity',
    required: false,
    description: 'Filter by severity',
    example: 'critical',
  })
  @ApiResponse({
    status: 200,
    description: 'Alert history fetched successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing user token',
  })
  @UseGuards(OwnerGuard)
  @IsOwner({ paramKey: 'flowId', resource: 'flow' })
  @Get('alert-history')
  async getAlertHistory(
    @Req() req: AuthenticatedRequest,
    @Param('flowId') flowId: string,
    @Query() query: AlertHistoryQueryDto
  ) {
    const userId = getUserIdFromRequest(req);
    return this.notificationsService.getAlertHistory(userId, flowId, query);
  }
}
