import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Module } from './schemas/module.schema';
import { CreateModuleDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';

@Injectable()
export class ModulesService {
  constructor(@InjectModel(Module.name) private moduleModel: Model<Module>) {}

  async create(dto: CreateModuleDto) {
    const created = new this.moduleModel(dto);
    return created.save();
  }

  async findAll() {
    return this.moduleModel.find().exec();
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
