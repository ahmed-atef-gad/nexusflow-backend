import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { LogicService } from './logic.service';
import { LogicPayload } from './types/flow.types';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiCookieAuth,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard } from '../guards/auth/auth.guard';
import { Logic } from './schemas/logic.schema';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../guards/auth/roles.guard';
import { Role } from '../users/enums/role.enum';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';

@ApiTags('Logics (Execution Program)')
@ApiCookieAuth('jwt')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.Admin)
@Controller('logics')
export class LogicController {
  constructor(private readonly logicService: LogicService) {}

  @ApiOperation({ summary: 'Create a Logic document manually' })
  @ApiBody({ type: LogicPayload })
  @ApiResponse({ status: 201, description: 'Logic created', type: Logic })
  @Post()
  create(@Body() body: LogicPayload) {
    return this.logicService.create(body);
  }

  @ApiOperation({ summary: 'Get all logic documents' })
  @ApiResponse({ status: 200 })
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
  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.logicService.findAll(query);
  }

  @ApiOperation({ summary: 'Get logic by ID' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: Logic })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.logicService.findOne(id);
  }

  @ApiOperation({ summary: 'Get logic by Flow ID' })
  @ApiParam({ name: 'flowId' })
  @ApiResponse({ status: 200, type: Logic })
  @Get('flow/:flowId')
  findByFlowId(@Param('flowId') flowId: string) {
    return this.logicService.findByFlowId(flowId);
  }

  @ApiOperation({ summary: 'Update logic by ID' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: LogicPayload })
  @ApiResponse({ status: 200, type: Logic })
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Partial<LogicPayload>) {
    return this.logicService.update(id, body);
  }

  @ApiOperation({ summary: 'Delete logic by ID' })
  @ApiParam({ name: 'id' })
  @ApiResponse({
    status: 200,
    description: 'Logic deleted successfully',
    schema: { example: { acknowledged: true, deletedCount: 1 } },
  })
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.logicService.delete(id);
  }
}
