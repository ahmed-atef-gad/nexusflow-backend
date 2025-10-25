import { Controller, Post, Body, UseGuards, Request, Get, Param, Patch, Delete } from '@nestjs/common';
import { FlowsService } from './flows.service';
import { Flow } from './schemas/flow.schema';
import { CreateFlowDto } from './dto/create-flow.dto';
import { UpdateFlowDto } from './dto/update-flow.dto';
    

@Controller('flows')
export class FlowsController {
  constructor(private readonly flowsService: FlowsService) {}

  @Post()
  async create(@Body() createFlowDto: CreateFlowDto, @Request() req): Promise<Flow> {
    const userId = req.user.id;
    return this.flowsService.create(createFlowDto, userId);
  }

  @Get()
  async findAll(@Request() req): Promise<Flow[]> {
    const userId = req.user.id;
    return this.flowsService.findAllByUser(userId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req): Promise<Flow> {
    const userId = req.user.id;
    return this.flowsService.findOne(id, userId);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateFlowDto: UpdateFlowDto, @Request() req): Promise<Flow> {
    const userId = req.user.id;
    return this.flowsService.update(id, userId, updateFlowDto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @Request() req): Promise<Flow> {
    const userId = req.user.id;
    return this.flowsService.delete(id, userId);
  }
}
