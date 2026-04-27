import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Get,
  Param,
  Patch,
  Delete,
  Query,
} from '@nestjs/common';
import { FlowsService } from './flows.service';
import { Flow } from './schemas/flow.schema';
import { AuthGuard } from '../guards/auth/auth.guard';
import {
  ApiTags,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiBadRequestResponse,
  ApiQuery,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/utils/auth.util';
import { getUserIdFromRequest } from '../auth/utils/auth.util';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { CreateFlowDto } from './dto/create-flow.dto';
import { FlowWithUiAndWarnings } from './flows.service';

const FLOW_REQUEST_EXAMPLE = {
  name: 'My IoT Flow',
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
          code: 'const value = Number(msg.payload.result);\nmsg.payload = value > 127 ? 1 : 0;\nreturn msg;\n',
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

@ApiTags('flows')
@ApiCookieAuth('jwt')
@UseGuards(AuthGuard)
@Controller('flows')
export class FlowsController {
  constructor(private readonly flowsService: FlowsService) {}

  @ApiOperation({
    summary: 'Create a Flow',
    description:
      'Creates a Flow and automatically calculates/saves the associated Setup and Logic documents.',
  })
  @ApiBody({
    type: CreateFlowDto,
    description: 'Flow payload example',
    examples: {
      flow: {
        summary: 'Real flow payload',
        value: FLOW_REQUEST_EXAMPLE,
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Flow created' })
  @ApiBadRequestResponse({ description: 'Bad request' })
  @Post()
  async create(
    @Body() createFlow: CreateFlowDto,
    @Request() req: AuthenticatedRequest
  ): Promise<FlowWithUiAndWarnings> {
    const userId = getUserIdFromRequest(req);
    return this.flowsService.create(createFlow as Flow, userId);
  }

  @ApiOperation({ summary: 'Get all flows for authenticated user' })
  @ApiResponse({ status: 200, description: 'List of flows' })
  @ApiBadRequestResponse({ description: 'Bad request' })
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
    description: 'Case-insensitive search by flow name',
    example: 'living room',
  })
  @Get()
  async findAll(
    @Request() req: AuthenticatedRequest,
    @Query() query: PaginationQueryDto
  ): Promise<{
    data: Flow[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const userId = getUserIdFromRequest(req);
    return this.flowsService.findAllByUser(userId, query);
  }

  @ApiOperation({ summary: 'Get flow by id' })
  @ApiParam({ name: 'id', description: 'Flow id' })
  @ApiResponse({ status: 200, description: 'Flow found' })
  @ApiResponse({ status: 404, description: 'Flow not found' })
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest
  ): Promise<Flow> {
    const userId = getUserIdFromRequest(req);
    return (await this.flowsService.findOne(id, userId)) as Flow;
  }

  @ApiOperation({ summary: 'Update a flow' })
  @ApiParam({ name: 'id', description: 'Flow id' })
  @ApiBody({
    type: CreateFlowDto,
    description: 'Flow payload example',
    examples: {
      flow: {
        summary: 'Real flow payload',
        value: FLOW_REQUEST_EXAMPLE,
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Flow updated' })
  @ApiResponse({ status: 404, description: 'Flow not found' })
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateFlow: CreateFlowDto,
    @Request() req: AuthenticatedRequest
  ): Promise<FlowWithUiAndWarnings> {
    const userId = getUserIdFromRequest(req);
    return this.flowsService.update(id, userId, updateFlow as Flow);
  }

  @ApiOperation({ summary: 'Delete a flow' })
  @ApiParam({ name: 'id', description: 'Flow id' })
  @ApiResponse({ status: 200, description: 'Flow deleted' })
  @ApiResponse({ status: 404, description: 'Flow not found' })
  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest
  ): Promise<{ success: boolean; message: string; id: string }> {
    const userId = getUserIdFromRequest(req);
    await this.flowsService.delete(id, userId);

    return { success: true, message: 'Flow deleted successfully', id };
  }
}
