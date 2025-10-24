import { Controller, Get, Post, Body, Param, Put, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ModulesService } from './modules.service';
import { CreateModuleDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { Module } from './schemas/module.schema';

@ApiTags('Modules')
@Controller('modules')
export class ModulesController {
  constructor(private readonly modulesService: ModulesService) {}

  @Post()
  @ApiOperation({ summary: 'Create new module' })
  @ApiResponse({ status: 201, description: 'Module created successfully' })
  create(@Body() dto: CreateModuleDto): Promise<Module> {
    return this.modulesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all modules' })
  findAll(): Promise<Module[]> {
    return this.modulesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get module by ID' })
  findOne(@Param('id') id: string): Promise<Module> {
    return this.modulesService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update module by ID' })
  update(@Param('id') id: string, @Body() dto: UpdateModuleDto): Promise<Module> {
    return this.modulesService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete module by ID' })
  delete(@Param('id') id: string) {
    return this.modulesService.delete(id);
  }
}
