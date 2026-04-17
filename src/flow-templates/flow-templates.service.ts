import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { FlowsService } from 'src/flows/flows.service';
import { Flow } from 'src/flows/schemas/flow.schema';
import { CreateFlowTemplateDto } from './dto/create-flow-template.dto';
import { UpdateFlowTemplateDto } from './dto/update-flow-template.dto';
import {
  FlowTemplate,
  FlowTemplateDocument,
} from './schemas/flow-template.schema';

@Injectable()
export class FlowTemplatesService {
  constructor(
    @InjectModel(FlowTemplate.name)
    private readonly flowTemplateModel: Model<FlowTemplateDocument>,
    private readonly flowsService: FlowsService
  ) {}

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid id format');
    }
  }

  private sanitizeTags(tags?: string[]): string[] {
    if (!tags) {
      return [];
    }

    return Array.from(
      new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))
    );
  }

  async create(dto: CreateFlowTemplateDto, adminId: string) {
    const createdTemplate = new this.flowTemplateModel({
      ...dto,
      name: dto.name.trim(),
      description: dto.description?.trim() ?? '',
      tags: this.sanitizeTags(dto.tags),
      createdBy: adminId,
    });

    return createdTemplate.save();
  }

  async findAll(query: PaginationQueryDto): Promise<{
    data: FlowTemplateDocument[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const parsedPage = Number(query.page);
    const parsedLimit = Number(query.limit);

    const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 100)
        : 10;
    const filter: Record<string, unknown> = {};

    if (query.search?.trim()) {
      const escaped = query.search
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escaped, 'i');
      filter.name = searchRegex;
    }

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.flowTemplateModel
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.flowTemplateModel.countDocuments(filter).exec(),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: total > 0 ? Math.ceil(total / limit) : 1,
    };
  }

  async findOne(id: string) {
    this.validateObjectId(id);

    const template = await this.flowTemplateModel.findById(id).exec();
    if (!template) {
      throw new NotFoundException(`Flow template with ID ${id} not found`);
    }

    return template;
  }

  async update(id: string, dto: UpdateFlowTemplateDto) {
    this.validateObjectId(id);

    const updatePayload: UpdateFlowTemplateDto = { ...dto };

    if (dto.name !== undefined) {
      updatePayload.name = dto.name.trim();
    }

    if (dto.description !== undefined) {
      updatePayload.description = dto.description.trim();
    }

    if (dto.tags !== undefined) {
      updatePayload.tags = this.sanitizeTags(dto.tags);
    }

    const updatedTemplate = await this.flowTemplateModel
      .findByIdAndUpdate(id, updatePayload, { new: true })
      .exec();

    if (!updatedTemplate) {
      throw new NotFoundException(`Flow template with ID ${id} not found`);
    }

    return updatedTemplate;
  }

  async delete(id: string) {
    this.validateObjectId(id);

    const deletedTemplate = await this.flowTemplateModel
      .findByIdAndDelete(id)
      .exec();

    if (!deletedTemplate) {
      throw new NotFoundException(`Flow template with ID ${id} not found`);
    }

    return { message: 'Flow template deleted successfully' };
  }

  async forkToFlow(templateId: string, userId: string, customFlowName?: string) {
    const template = await this.findOne(templateId);

    const flowName =
      customFlowName?.trim() && customFlowName.trim().length > 0
        ? customFlowName.trim()
        : `${template.name} Copy`;

    const payload: Flow = {
      name: flowName,
      userId: userId as any,
      nodes: JSON.parse(JSON.stringify(template.nodes ?? [])),
      edges: JSON.parse(JSON.stringify(template.edges ?? [])),
      viewport: template.viewport ?? { x: 0, y: 0, zoom: 1 },
    };

    return this.flowsService.create(payload, userId);
  }
}

