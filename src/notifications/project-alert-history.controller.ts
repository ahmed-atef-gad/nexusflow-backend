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

@ApiTags('Notifications')
@ApiCookieAuth('jwt')
@UseGuards(AuthGuard)
@Controller('v1/projects/:projectId')
export class ProjectAlertHistoryController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @ApiOperation({
    summary: 'Get alert history for a project',
    description:
      'Returns alerts sorted by occurredAt descending using cursor-based pagination.',
  })
  @ApiParam({
    name: 'projectId',
    description: 'Project identifier',
    example: 'project-alpha',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of records (default 50, max 100)',
    example: '50',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Pagination cursor from previous response',
  })
  @ApiResponse({
    status: 200,
    description: 'Alert history fetched successfully',
    schema: {
      example: {
        items: [
          {
            id: '6802ec3f7fd4db8af143dcf1',
            projectId: 'project-alpha',
            sensorType: 'MQ',
            severity: 'critical',
            title: 'Gas Leak Alert',
            body: 'MQ level is 430 (threshold 300)',
            value: 430,
            threshold: 300,
            ruleId: 'rule_22',
            occurredAt: '2026-04-19T09:10:00.000Z',
            createdAt: '2026-04-19T09:10:01.005Z',
          },
        ],
        nextCursor:
          'eyJvY2N1cnJlZEF0IjoiMjAyNi0wNC0xOVQwOToxMDowMC4wMDBaIiwiaWQiOiI2ODAyZWMzZjdmZDRkYjhhZjE0M2RjZjEifQ==',
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing user token',
  })
  @Get('alert-history')
  async getAlertHistory(
    @Req() req: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Query() query: AlertHistoryQueryDto
  ) {
    const userId = getUserIdFromRequest(req);
    return this.notificationsService.getAlertHistory(userId, projectId, query);
  }
}
