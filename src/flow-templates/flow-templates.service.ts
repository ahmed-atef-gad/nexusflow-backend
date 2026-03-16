import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
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

  async findAll() {
    return this.flowTemplateModel.find().sort({ updatedAt: -1 }).exec();
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

