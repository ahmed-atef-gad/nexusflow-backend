import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Module } from './schemas/module.schema';
import { CreateModuleDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';

@Injectable()
export class ModulesService {
  constructor(@InjectModel(Module.name) private moduleModel: Model<Module>) {}

  async create(dto: CreateModuleDto) {
    const created = new this.moduleModel(dto);
    return created.save();
  }

  async findAll(query: PaginationQueryDto): Promise<{
    data: Module[];
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
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.moduleModel
        .find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.moduleModel.countDocuments().exec(),
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
    const module = await this.moduleModel.findById(id).exec();
    if (!module) throw new NotFoundException(`Module with id ${id} not found`);
    return module;
  }

  async update(id: string, dto: UpdateModuleDto) {
    const updated = await this.moduleModel.findByIdAndUpdate(id, dto, { new: true }).exec();
    if (!updated) throw new NotFoundException(`Module with id ${id} not found`);
    return updated;
  }

  async delete(id: string) {
    const deleted = await this.moduleModel.findByIdAndDelete(id).exec();
    if (!deleted) throw new NotFoundException(`Module with id ${id} not found`);
    return { message: 'Module deleted successfully' };
  }
}
