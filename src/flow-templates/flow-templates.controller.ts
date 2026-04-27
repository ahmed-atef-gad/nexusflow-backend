import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { getUserIdFromRequest } from 'src/auth/utils/auth.util';
import type { AuthenticatedRequest } from 'src/auth/utils/auth.util';
import { AuthGuard } from 'src/guards/auth/auth.guard';
import { RolesGuard } from 'src/guards/auth/roles.guard';
import { Role } from 'src/users/enums/role.enum';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { CreateFlowTemplateDto } from './dto/create-flow-template.dto';
import { ForkFlowTemplateDto } from './dto/fork-flow-template.dto';
import { UpdateFlowTemplateDto } from './dto/update-flow-template.dto';
import { FlowTemplatesService } from './flow-templates.service';

const FLOW_TEMPLATE_REQUEST_EXAMPLE = {
  name: 'Smart Home Lighting Starter',
  description: 'Template flow for motion-triggered home lighting.',
  tags: ['smart-home', 'lighting'],
  nodes: [
    {
      id: 'ESP32-gpio-input-analog-1776457433160-49c',
      type: 'module',
      position: { x: -112, y: 160 },
      data: {
        ports: 'source',
        variables: { pinNumber: '33' },
        moduleId: 'ESP32-gpio-input-analog',
        name: 'Analog Input',
        color: 'from-amber-300 to-orange-500',
        icon: {},
        category: 'Hardware',
        pinMode: 'ANALOG',
      },
      measured: { width: 160, height: 110 },
      selected: false,
      dragging: false,
    },
    {
      id: 'ESP32-gpio-output-pwm-1776457435349-gia',
      type: 'module',
      position: { x: 512, y: 32 },
      data: {
        ports: 'target',
        variables: { pinNumber: '22' },
        moduleId: 'ESP32-gpio-output-pwm',
        name: 'PWM Output',
        color: 'from-green-500 to-lime-500',
        icon: {},
        category: 'Hardware',
        pinMode: 'PWM',
      },
      measured: { width: 160, height: 110 },
      selected: false,
    },
    {
      id: 'logic-function-1776457439267-3ju',
      type: 'module',
      position: { x: 336, y: 336 },
      data: {
        notes:
          'Use msg.payload as the current value. Return msg, return { payload }, a primitive value, or null to stop the flow.',
        ports: 'both',
        variables: {
          code: 'const value = Number(msg.payload.result);\\nmsg.payload = value > 127 ? 1 : 0;\\nreturn msg;\\n',
        },
        moduleId: 'logic-function',
        name: 'Function',
        color: 'from-slate-700 to-cyan-600',
        icon: {},
        category: 'Logic',
      },
      measured: { width: 160, height: 110 },
      selected: false,
      dragging: false,
    },
    {
      id: 'ESP32-gpio-output-led-1776457598845-w8z',
      type: 'module',
      position: { x: 720, y: 336 },
      data: {
        ports: 'target',
        variables: { pinNumber: '21' },
        moduleId: 'ESP32-gpio-output-led',
        name: 'LED',
        color: 'from-green-500 to-lime-500',
        icon: {},
        category: 'Hardware',
        pinMode: 'OUTPUT',
      },
      measured: { width: 160, height: 110 },
      selected: false,
    },
  ],
  edges: [
    {
      id: 'xy-edge__ESP32-gpio-input-analog-1776457433160-49c-ESP32-gpio-output-pwm-1776457435349-gia',
      source: 'ESP32-gpio-input-analog-1776457433160-49c',
      target: 'ESP32-gpio-output-pwm-1776457435349-gia',
      animated: true,
    },
    {
      id: 'xy-edge__ESP32-gpio-input-analog-1776457433160-49c-logic-function-1776457439267-3ju',
      source: 'ESP32-gpio-input-analog-1776457433160-49c',
      target: 'logic-function-1776457439267-3ju',
      animated: true,
    },
    {
      id: 'xy-edge__logic-function-1776457439267-3ju-ESP32-gpio-output-led-1776457598845-w8z',
      source: 'logic-function-1776457439267-3ju',
      target: 'ESP32-gpio-output-led-1776457598845-w8z',
      animated: true,
    },
  ],
  viewport: {
    x: 139.47042262362334,
    y: 54.7662475627634,
    zoom: 1.148698354997035,
  },
};

@ApiTags('Flow Templates')
@Controller('flow-templates')
export class FlowTemplatesController {
  constructor(private readonly flowTemplatesService: FlowTemplatesService) {}

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @ApiCookieAuth('jwt')
  @Roles(Role.Admin)
  @ApiOperation({ summary: 'Create flow template (Admin)' })
  @ApiBody({
    type: CreateFlowTemplateDto,
    description: 'Flow template payload example',
    examples: {
      template: {
        summary: 'Real flow template payload',
        value: FLOW_TEMPLATE_REQUEST_EXAMPLE,
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Flow template created' })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing token',
  })
  @ApiForbiddenResponse({ description: 'Forbidden - Admin role required' })
  create(
    @Body() dto: CreateFlowTemplateDto,
    @Request() req: AuthenticatedRequest
  ) {
    const adminId = getUserIdFromRequest(req);
    return this.flowTemplatesService.create(dto, adminId);
  }

  @Get()
  @ApiOperation({ summary: 'List flow templates' })
  @ApiOkResponse({ description: 'Templates fetched successfully' })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number, starts from 1',
    example: '1',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Items per page, max 100',
    example: '10',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Case-insensitive search by template name',
    example: 'living room',
  })
  findAll(@Query() query: PaginationQueryDto) {
    return this.flowTemplatesService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get flow template by ID' })
  @ApiOkResponse({ description: 'Template fetched successfully' })
  @ApiBadRequestResponse({ description: 'Invalid id format' })
  @ApiNotFoundResponse({ description: 'Template not found' })
  findOne(@Param('id') id: string) {
    return this.flowTemplatesService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(AuthGuard, RolesGuard)
  @ApiCookieAuth('jwt')
  @Roles(Role.Admin)
  @ApiOperation({ summary: 'Update flow template (Admin)' })
  @ApiBody({
    type: UpdateFlowTemplateDto,
    description: 'Flow template payload example',
    examples: {
      template: {
        summary: 'Real flow template payload',
        value: FLOW_TEMPLATE_REQUEST_EXAMPLE,
      },
    },
  })
  @ApiOkResponse({ description: 'Template updated successfully' })
  @ApiBadRequestResponse({ description: 'Invalid id format' })
  @ApiNotFoundResponse({ description: 'Template not found' })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing token',
  })
  @ApiForbiddenResponse({ description: 'Forbidden - Admin role required' })
  update(@Param('id') id: string, @Body() dto: UpdateFlowTemplateDto) {
    return this.flowTemplatesService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard, RolesGuard)
  @ApiCookieAuth('jwt')
  @Roles(Role.Admin)
  @ApiOperation({ summary: 'Delete flow template (Admin)' })
  @ApiOkResponse({ description: 'Template deleted successfully' })
  @ApiBadRequestResponse({ description: 'Invalid id format' })
  @ApiNotFoundResponse({ description: 'Template not found' })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing token',
  })
  @ApiForbiddenResponse({ description: 'Forbidden - Admin role required' })
  delete(@Param('id') id: string) {
    return this.flowTemplatesService.delete(id);
  }

  @Post(':id/fork')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('jwt')
  @ApiOperation({ summary: 'Fork a template into user flows' })
  @ApiResponse({ status: 201, description: 'Flow forked successfully' })
  @ApiBadRequestResponse({ description: 'Invalid template id format' })
  @ApiNotFoundResponse({ description: 'Template not found' })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing token',
  })
  fork(
    @Param('id') id: string,
    @Body() dto: ForkFlowTemplateDto,
    @Request() req: AuthenticatedRequest
  ) {
    const userId = getUserIdFromRequest(req);
    return this.flowTemplatesService.forkToFlow(id, userId, dto?.name);
  }
}
