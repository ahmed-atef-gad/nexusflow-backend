import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from 'src/auth/decorators/roles.decorator';
import {
  getUserIdFromRequest,
  type AuthenticatedRequest,
} from 'src/auth/utils/auth.util';
import { AuthGuard } from 'src/guards/auth/auth.guard';
import { RolesGuard } from 'src/guards/auth/roles.guard';
import { Role } from 'src/users/enums/role.enum';
import { CreateAlertRuleDto } from './dto/create-alert-rule.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { UpdateAlertRuleDto } from './dto/update-alert-rule.dto';
import { UpsertAlertPoliciesDto } from './dto/upsert-alert-policies.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiCookieAuth('jwt')
@UseGuards(AuthGuard)
@Controller('v1')
export class ProjectAlertConfigController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @ApiOperation({ summary: 'Get global alert policies' })
  @ApiQuery({
    name: 'moduleId',
    required: false,
    description: 'Optional module filter',
    example: 'DHT-Sensor-22',
  })
  @Get('alert-policies')
  async getAlertPolicies(@Query('moduleId') moduleId?: string) {
    return this.notificationsService.getAlertPolicies(moduleId);
  }

  @ApiOperation({ summary: 'Upsert global alert policies (Admin only)' })
  @ApiBody({ type: UpsertAlertPoliciesDto })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing user token',
  })
  @UseGuards(RolesGuard)
  @Roles(Role.Admin)
  @Put('alert-policies')
  async upsertAlertPolicies(@Body() body: UpsertAlertPoliciesDto) {
    return this.notificationsService.upsertAlertPolicies(body);
  }

  @ApiOperation({ summary: 'Get notification preferences for a flow' })
  @ApiParam({ name: 'flowId', description: 'Flow identifier' })
  @ApiResponse({ status: 200, description: 'Flow notification preferences' })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing user token',
  })
  @Get('flows/:flowId/notification-preferences')
  async getNotificationPreferences(
    @Req() req: AuthenticatedRequest,
    @Param('flowId') flowId: string
  ) {
    const userId = getUserIdFromRequest(req);
    return this.notificationsService.getNotificationPreferences(userId, flowId);
  }

  @ApiOperation({ summary: 'Create or replace notification preferences' })
  @ApiParam({ name: 'flowId', description: 'Flow identifier' })
  @ApiBody({ type: UpdateNotificationPreferencesDto })
  @Put('flows/:flowId/notification-preferences')
  async updateNotificationPreferences(
    @Req() req: AuthenticatedRequest,
    @Param('flowId') flowId: string,
    @Body() body: UpdateNotificationPreferencesDto
  ) {
    const userId = getUserIdFromRequest(req);
    return this.notificationsService.updateNotificationPreferences(
      userId,
      flowId,
      body
    );
  }

  @ApiOperation({ summary: 'List alert rules for a flow' })
  @ApiParam({ name: 'flowId', description: 'Flow identifier' })
  @ApiQuery({
    name: 'nodeId',
    required: false,
    description: 'Filter by node instance id',
  })
  @Get('flows/:flowId/alert-rules')
  async getAlertRules(
    @Req() req: AuthenticatedRequest,
    @Param('flowId') flowId: string,
    @Query('nodeId') nodeId?: string
  ) {
    const userId = getUserIdFromRequest(req);
    return this.notificationsService.getAlertRules(userId, flowId, nodeId);
  }

  @ApiOperation({ summary: 'Get a single alert rule' })
  @ApiParam({ name: 'flowId', description: 'Flow identifier' })
  @ApiParam({ name: 'ruleId', description: 'Alert rule id' })
  @Get('flows/:flowId/alert-rules/:ruleId')
  async getAlertRule(
    @Req() req: AuthenticatedRequest,
    @Param('flowId') flowId: string,
    @Param('ruleId') ruleId: string
  ) {
    const userId = getUserIdFromRequest(req);
    return this.notificationsService.getAlertRule(userId, flowId, ruleId);
  }

  @ApiOperation({ summary: 'Create a new alert rule for a flow' })
  @ApiParam({ name: 'flowId', description: 'Flow identifier' })
  @ApiBody({ type: CreateAlertRuleDto })
  @ApiResponse({ status: 201, description: 'Alert rule created' })
  @Post('flows/:flowId/alert-rules')
  async createAlertRule(
    @Req() req: AuthenticatedRequest,
    @Param('flowId') flowId: string,
    @Body() body: CreateAlertRuleDto
  ) {
    const userId = getUserIdFromRequest(req);
    return this.notificationsService.createAlertRule(userId, flowId, body);
  }

  @ApiOperation({ summary: 'Update an alert rule' })
  @ApiParam({ name: 'flowId', description: 'Flow identifier' })
  @ApiParam({ name: 'ruleId', description: 'Alert rule id' })
  @ApiBody({ type: UpdateAlertRuleDto })
  @Patch('flows/:flowId/alert-rules/:ruleId')
  async updateAlertRule(
    @Req() req: AuthenticatedRequest,
    @Param('flowId') flowId: string,
    @Param('ruleId') ruleId: string,
    @Body() body: UpdateAlertRuleDto
  ) {
    const userId = getUserIdFromRequest(req);
    return this.notificationsService.updateAlertRule(
      userId,
      flowId,
      ruleId,
      body
    );
  }

  @ApiOperation({ summary: 'Delete an alert rule' })
  @ApiParam({ name: 'flowId', description: 'Flow identifier' })
  @ApiParam({ name: 'ruleId', description: 'Alert rule id' })
  @ApiResponse({ status: 204, description: 'Alert rule deleted' })
  @HttpCode(204)
  @Delete('flows/:flowId/alert-rules/:ruleId')
  async deleteAlertRule(
    @Req() req: AuthenticatedRequest,
    @Param('flowId') flowId: string,
    @Param('ruleId') ruleId: string
  ) {
    const userId = getUserIdFromRequest(req);
    await this.notificationsService.deleteAlertRule(userId, flowId, ruleId);
  }
}
