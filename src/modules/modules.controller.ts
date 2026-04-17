import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ModulesService } from './modules.service';
import { CreateModuleDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { AuthGuard } from '../gaurds/auth/auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../gaurds/auth/roles.guard';
import { Role } from '../users/enums/role.enum';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';

/**
 * ModulesController
 *
 * Admin endpoints for managing the module catalog used by flows.
 */
@ApiTags('Modules Management')
@ApiCookieAuth('jwt')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.Admin)
@Controller('modules')
export class ModulesController {
  constructor(private readonly modulesService: ModulesService) {}

  /**
   * Create a new module (Admin only).
   *
   * @route POST /modules
   */
  @Post()
  @ApiOperation({
    summary: 'Create module (Admin)',
    description: 'Creates a new module entry in the catalog.',
  })
  @ApiBody({ type: CreateModuleDto })
  @ApiResponse({
    status: 201,
    description: 'Module created successfully',
    schema: {
      example: {
        _id: '507f1f77bcf86cd799439011',
        name: 'ESP32 GPIO',
        icon: 'chip',
        color: 'from-green-400 to-blue-500',
        category: 'Hardware',
        ports: 'both',
        type: 'gpio',
        alias: 'ESP32_GPIO',
        notes: 'Used to control GPIO pins',
        options: { voltage: '3.3V' },
        variables: { pin: '12' },
        createdAt: '2024-02-10T10:30:00Z',
        updatedAt: '2024-02-10T10:30:00Z',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid input data' })
  @ApiInternalServerErrorResponse({ description: 'Server error while creating module' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid or missing token' })
  @ApiForbiddenResponse({ description: 'Forbidden - Admin role required' })
  create(@Body() createModuleDto: CreateModuleDto) {
    return this.modulesService.create(createModuleDto);
  }

  /**
   * Get all modules (Admin only).
   *
   * @route GET /modules
   */
  @Get()
  @ApiOperation({
    summary: 'List modules (Admin)',
    description: 'Returns all module entries in the catalog.',
  })
  @ApiOkResponse({
    description: 'List of all modules',
    schema: {
      example: [
        {
          _id: '507f1f77bcf86cd799439011',
          name: 'ESP32 GPIO',
          category: 'Hardware',
          ports: 'both',
        },
      ],
    },
  })
  @ApiInternalServerErrorResponse({ description: 'Server error while fetching modules' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid or missing token' })
  @ApiForbiddenResponse({ description: 'Forbidden - Admin role required' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.modulesService.findAll(query);
  }

  /**
   * Get module by ID (Admin only).
   *
   * @route GET /modules/:id
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get module by ID (Admin)',
    description: 'Fetches a module entry by MongoDB ID.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB ID of the module',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiOkResponse({
    description: 'Module fetched successfully',
    schema: {
      example: {
        _id: '507f1f77bcf86cd799439011',
        name: 'ESP32 GPIO',
        icon: 'chip',
        color: 'from-green-400 to-blue-500',
        category: 'Hardware',
        ports: 'both',
        type: 'gpio',
        alias: 'ESP32_GPIO',
        notes: 'Used to control GPIO pins',
        options: { voltage: '3.3V' },
        variables: { pin: '12' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Module not found' })
  @ApiBadRequestResponse({ description: 'Invalid module ID format' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid or missing token' })
  @ApiForbiddenResponse({ description: 'Forbidden - Admin role required' })
  findOne(@Param('id') id: string) {
    return this.modulesService.findOne(id);
  }

  /**
   * Update a module (Admin only).
   *
   * @route PATCH /modules/:id
   */
  @Patch(':id')
  @ApiOperation({
    summary: 'Update module (Admin)',
    description: 'Updates module fields by MongoDB ID.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB ID of the module',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiBody({ type: UpdateModuleDto })
  @ApiOkResponse({
    description: 'Module updated successfully',
    schema: {
      example: {
        _id: '507f1f77bcf86cd799439011',
        name: 'ESP32 GPIO Controller',
        icon: 'Cpu',
        color: 'from-green-400 to-blue-500',
        category: 'GPIO',
        ports: 'source',
        alias: 'ESP32_GPIO',
        updatedAt: '2024-02-15T09:10:00Z',
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Module not found' })
  @ApiBadRequestResponse({ description: 'Invalid update data or ID' })
  @ApiInternalServerErrorResponse({ description: 'Server error while updating module' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid or missing token' })
  @ApiForbiddenResponse({ description: 'Forbidden - Admin role required' })
  update(@Param('id') id: string, @Body() updateModuleDto: UpdateModuleDto) {
    return this.modulesService.update(id, updateModuleDto);
  }

  /**
   * Delete a module (Admin only).
   *
   * @route DELETE /modules/:id
   */
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete module (Admin)',
    description: 'Deletes a module entry by MongoDB ID.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB ID of the module',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiOkResponse({
    description: 'Module deleted successfully',
    schema: {
      example: {
        acknowledged: true,
        deletedCount: 1,
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Module not found' })
  @ApiBadRequestResponse({ description: 'Invalid module ID format' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid or missing token' })
  @ApiForbiddenResponse({ description: 'Forbidden - Admin role required' })
  delete(@Param('id') id: string) {
    return this.modulesService.delete(id);
  }
}
