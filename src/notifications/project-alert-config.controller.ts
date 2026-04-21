import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { getUserIdFromRequest, type AuthenticatedRequest } from 'src/auth/utils/auth.util';
import { AuthGuard } from 'src/gaurds/auth/auth.guard';
import { CreateAlertRuleDto } from './dto/create-alert-rule.dto';
import { UpdateAlertRuleDto } from './dto/update-alert-rule.dto';
import { UpsertAlertPoliciesDto } from './dto/upsert-alert-policies.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiCookieAuth('jwt')
@UseGuards(AuthGuard)
@Controller('v1/projects/:projectId')
export class ProjectAlertConfigController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @ApiOperation({
    summary: 'Get alert policies for a project',
  })
  @ApiParam({ name: 'projectId', description: 'Project identifier' })
  @ApiResponse({ status: 200, description: 'Project alert policies' })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing user token',
  })
  @Get('alert-policies')
  async getAlertPolicies(
    @Req() req: AuthenticatedRequest,
    @Param('projectId') projectId: string,
  ) {
    const userId = getUserIdFromRequest(req);
    return this.notificationsService.getAlertPolicies(userId, projectId);
  }

  @ApiOperation({
    summary: 'Upsert alert policies for a project',
  })
  @ApiParam({ name: 'projectId', description: 'Project identifier' })
  @ApiBody({ type: UpsertAlertPoliciesDto })
  @ApiResponse({
    status: 200,
    description: 'Alert policies upserted successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing user token',
  })
  @Put('alert-policies')
  async upsertAlertPolicies(
    @Req() req: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Body() body: UpsertAlertPoliciesDto,
  ) {
    const userId = getUserIdFromRequest(req);
    return this.notificationsService.upsertAlertPolicies(userId, projectId, body);
  }

  @ApiOperation({
    summary: 'List alert rules for a project',
  })
  @ApiParam({ name: 'projectId', description: 'Project identifier' })
  @ApiResponse({ status: 200, description: 'Alert rules list' })
  @Get('alert-rules')
  async getAlertRules(
    @Req() req: AuthenticatedRequest,
    @Param('projectId') projectId: string,
  ) {
    const userId = getUserIdFromRequest(req);
    return this.notificationsService.getAlertRules(userId, projectId);
  }

  @ApiOperation({
    summary: 'Create a new alert rule for a project',
  })
  @ApiParam({ name: 'projectId', description: 'Project identifier' })
  @ApiBody({ type: CreateAlertRuleDto })
  @ApiResponse({ status: 201, description: 'Alert rule created' })
  @Post('alert-rules')
  async createAlertRule(
    @Req() req: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Body() body: CreateAlertRuleDto,
  ) {
    const userId = getUserIdFromRequest(req);
    return this.notificationsService.createAlertRule(userId, projectId, body);
  }

  @ApiOperation({
    summary: 'Update an alert rule',
  })
  @ApiParam({ name: 'projectId', description: 'Project identifier' })
  @ApiParam({ name: 'ruleId', description: 'Alert rule id' })
  @ApiBody({ type: UpdateAlertRuleDto })
  @ApiResponse({ status: 200, description: 'Alert rule updated' })
  @Patch('alert-rules/:ruleId')
  async updateAlertRule(
    @Req() req: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Param('ruleId') ruleId: string,
    @Body() body: UpdateAlertRuleDto,
  ) {
    const userId = getUserIdFromRequest(req);
    return this.notificationsService.updateAlertRule(
      userId,
      projectId,
      ruleId,
      body,
    );
  }

  @ApiOperation({
    summary: 'Delete an alert rule',
  })
  @ApiParam({ name: 'projectId', description: 'Project identifier' })
  @ApiParam({ name: 'ruleId', description: 'Alert rule id' })
  @ApiResponse({
    status: 200,
    description: 'Alert rule deleted',
    schema: {
      example: { acknowledged: true, deletedRuleId: '6802ec3f7fd4db8af143dcf1' },
    },
  })
  @Delete('alert-rules/:ruleId')
  async deleteAlertRule(
    @Req() req: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Param('ruleId') ruleId: string,
  ) {
    const userId = getUserIdFromRequest(req);
    return this.notificationsService.deleteAlertRule(userId, projectId, ruleId);
  }
}
