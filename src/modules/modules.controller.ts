import { 
  Controller, Get, Post, Body, Param, Delete, 
  Patch
} from '@nestjs/common';
import { ApiTags, ApiOkResponse, ApiBadRequestResponse, ApiNotFoundResponse, ApiInternalServerErrorResponse } from '@nestjs/swagger';
import { ModulesService } from './modules.service';
import { CreateModuleDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';

@ApiTags('Modules')
@Controller('modules')
export class ModulesController {
  constructor(private readonly modulesService: ModulesService) {}

  @Post()
  @ApiOkResponse({ description: 'Module created successfully' })
  @ApiBadRequestResponse({ description: 'Invalid input data' })
  @ApiInternalServerErrorResponse({ description: 'Server error while creating module' })
  create(@Body() createModuleDto: CreateModuleDto) {
    return this.modulesService.create(createModuleDto);
  }

  @Get()
  @ApiOkResponse({ description: 'List of all modules' })
  @ApiInternalServerErrorResponse({ description: 'Server error while fetching modules' })
  findAll() {
    return this.modulesService.findAll();
  }

  @Get(':id')
  @ApiOkResponse({ description: 'Module fetched successfully' })
  @ApiNotFoundResponse({ description: 'Module not found' })
  @ApiBadRequestResponse({ description: 'Invalid module ID format' })
  findOne(@Param('id') id: string) {
    return this.modulesService.findOne(id);
  }

  @Patch(':id')
  @ApiOkResponse({ description: 'Module updated successfully' })
  @ApiNotFoundResponse({ description: 'Module not found' })
  @ApiBadRequestResponse({ description: 'Invalid update data or ID' })
  @ApiInternalServerErrorResponse({ description: 'Server error while updating module' })
  update(@Param('id') id: string, @Body() updateModuleDto: UpdateModuleDto) {
    return this.modulesService.update(id, updateModuleDto);
  }

  @Delete(':id')
  @ApiOkResponse({ description: 'Module deleted successfully' })
  @ApiNotFoundResponse({ description: 'Module not found' })
  @ApiBadRequestResponse({ description: 'Invalid module ID format' })
  delete(@Param('id') id: string) {
    return this.modulesService.delete(id);
  }
}
