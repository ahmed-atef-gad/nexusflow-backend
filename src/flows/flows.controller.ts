import {
  Controller,
  Post,
  Body,
  UseGuards,
  UnauthorizedException,
  Request,
  Get,
  Param,
  Patch,
  Delete,
} from '@nestjs/common';
import { FlowsService } from './flows.service';
import { Flow } from './schemas/flow.schema';
import { AuthGuard } from '../gaurds/auth/auth.guard';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiBadRequestResponse,
} from '@nestjs/swagger';

@ApiTags('flows')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller('flows')
export class FlowsController {
  constructor(private readonly flowsService: FlowsService) {}

  @ApiOperation({ 
    summary: 'Create a Flow', 
    description: 'Creates a Flow and automatically calculates/saves the associated Setup and Logic documents.' 
  })
  @ApiBody({ type: Flow })
  @ApiResponse({ status: 201, description: 'Flow created' })
  @ApiBadRequestResponse({ description: 'Bad request' })
  @Post()
  async create(@Body() createFlow: Flow, @Request() req): Promise<Flow> {
    const userId = req.user?.id ?? req.user?.sub ?? req.user?.userId;
    if (!userId) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.flowsService.create(createFlow, userId);
  }

  @ApiOperation({ summary: 'Get all flows for authenticated user' })
  @ApiResponse({ status: 200, description: 'List of flows' })
  @ApiBadRequestResponse({ description: 'Bad request' })
  @Get()
  async findAll(@Request() req): Promise<Flow[]> {
    const userId = req.user?.id ?? req.user?.sub ?? req.user?.userId;
    if (!userId) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.flowsService.findAllByUser(userId);
  }

  @ApiOperation({ summary: 'Get flow by id' })
  @ApiParam({ name: 'id', description: 'Flow id' })
  @ApiResponse({ status: 200, description: 'Flow found' })
  @ApiResponse({ status: 404, description: 'Flow not found' })
  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req): Promise<Flow> {
    const userId = req.user?.id ?? req.user?.sub ?? req.user?.userId;
    return this.flowsService.findOne(id, userId);
  }

  @ApiOperation({ summary: 'Update a flow' })
  @ApiParam({ name: 'id', description: 'Flow id' })
  @ApiBody({ type: Flow })
  @ApiResponse({ status: 200, description: 'Flow updated' })
  @ApiResponse({ status: 404, description: 'Flow not found' })
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateFlow: Flow,
    @Request() req,
  ): Promise<Flow> {
    const userId = req.user?.id ?? req.user?.sub ?? req.user?.userId;
    return this.flowsService.update(id, userId, updateFlow);
  }

  @ApiOperation({ summary: 'Delete a flow' })
  @ApiParam({ name: 'id', description: 'Flow id' })
  @ApiResponse({ status: 200, description: 'Flow deleted' })
  @ApiResponse({ status: 404, description: 'Flow not found' })
  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @Request() req,
  ): Promise<{ success: boolean; message: string; id: string }> {
    const userId = req.user?.id ?? req.user?.sub ?? req.user?.userId;
    await this.flowsService.delete(id, userId);

    return { success: true, message: 'Flow deleted successfully', id };
  }
}
