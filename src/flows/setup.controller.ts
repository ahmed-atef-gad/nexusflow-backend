import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { SetupService } from './setup.service';
import { SetupPayload } from './types/flow.types';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { AuthGuard } from '../gaurds/auth/auth.guard';
import { Setup } from './schemas/setup.schema';

@ApiTags('Setups (Device Configuration)')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller('setups')
export class SetupController {
  constructor(private readonly setupService: SetupService) {}

  @ApiOperation({ summary: 'Create a Setup document manually' })
  @ApiBody({ type: SetupPayload })
  @ApiResponse({ status: 201, description: 'Setup created', type: Setup })
  @Post()
  create(@Body() body: SetupPayload) {
    return this.setupService.create(body);
  }

  @ApiOperation({ summary: 'Get all setups' })
  @ApiResponse({ status: 200, type: [Setup] })
  @Get()
  findAll() {
    return this.setupService.findAll();
  }

  @ApiOperation({ summary: 'Get setup by ID' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: Setup })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.setupService.findOne(id);
  }

  @ApiOperation({ summary: 'Get setup by Flow ID' })
  @ApiParam({ name: 'flowId' })
  @ApiResponse({ status: 200, type: Setup })
  @Get('flow/:flowId')
  findByFlowId(@Param('flowId') flowId: string) {
    return this.setupService.findByFlowId(flowId);
  }

  @ApiOperation({ summary: 'Update setup by ID' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: SetupPayload })
  @ApiResponse({ status: 200, type: Setup })
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Partial<SetupPayload>) {
    return this.setupService.update(id, body);
  }

  @ApiOperation({ summary: 'Delete setup by ID' })
  @ApiParam({ name: 'id' })
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.setupService.delete(id);
  }
}