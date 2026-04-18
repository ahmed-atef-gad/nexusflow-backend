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
import { AuthGuard } from 'src/gaurds/auth/auth.guard';
import { RolesGuard } from 'src/gaurds/auth/roles.guard';
import { Role } from 'src/users/enums/role.enum';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { CreateFlowTemplateDto } from './dto/create-flow-template.dto';
import { ForkFlowTemplateDto } from './dto/fork-flow-template.dto';
import { UpdateFlowTemplateDto } from './dto/update-flow-template.dto';
import { FlowTemplatesService } from './flow-templates.service';

@ApiTags('Flow Templates')
@Controller('flow-templates')
export class FlowTemplatesController {
  constructor(private readonly flowTemplatesService: FlowTemplatesService) {}

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @ApiCookieAuth('jwt')
  @Roles(Role.Admin)
  @ApiOperation({ summary: 'Create flow template (Admin)' })
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
