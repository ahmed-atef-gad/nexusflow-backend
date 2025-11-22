import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Logic, LogicDocument } from './schemas/logic.schema';
import { LogicPayload } from './types/flow.types';

@Injectable()
export class LogicService {
  constructor(@InjectModel(Logic.name) private logicModel: Model<LogicDocument>) {}

  async create(data: LogicPayload): Promise<Logic> {
    const created = new this.logicModel(data);
    return created.save();
  }

  async findAll(): Promise<Logic[]> {
    return this.logicModel.find().exec();
  }

  async findOne(id: string): Promise<Logic> {
    const logic = await this.logicModel.findById(id).exec();
    if (!logic) throw new NotFoundException(`Logic with ID ${id} not found`);
    return logic;
  }

  // Changed return type to allow null
  async findByFlowId(flowId: string): Promise<Logic | null> {
    return this.logicModel.findOne({ flowId }).exec();
  }

  async update(id: string, data: Partial<LogicPayload>): Promise<Logic> {
    const updated = await this.logicModel
      .findByIdAndUpdate(id, data, { new: true })
      .exec();
    if (!updated) throw new NotFoundException(`Logic with ID ${id} not found`);
    return updated;
  }

  async upsertByFlowId(flowId: string, program: any): Promise<Logic> {
    const result = await this.logicModel.findOneAndUpdate(
      { flowId },
      { program },
      { upsert: true, new: true }
    ).exec();
    
    return result as Logic;
  }

  async delete(id: string): Promise<void> {
    const result = await this.logicModel.findByIdAndDelete(id).exec();
    if (!result) throw new NotFoundException(`Logic with ID ${id} not found`);
  }

  async deleteByFlowId(flowId: string): Promise<void> {
    await this.logicModel.deleteOne({ flowId }).exec();
  }
}