import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Setup, SetupDocument } from './schemas/setup.schema';
import { SetupPayload } from './types/flow.types';

@Injectable()
export class SetupService {
  constructor(@InjectModel(Setup.name) private setupModel: Model<SetupDocument>) {}

  async create(data: SetupPayload): Promise<Setup> {
    const created = new this.setupModel(data);
    return created.save();
  }

  async findAll(): Promise<Setup[]> {
    return this.setupModel.find().exec();
  }

  async findOne(id: string): Promise<Setup> {
    const setup = await this.setupModel.findById(id).exec();
    if (!setup) throw new NotFoundException(`Setup with ID ${id} not found`);
    return setup;
  }

  // Changed return type to allow null
  async findByFlowId(flowId: string): Promise<Setup | null> {
    return this.setupModel.findOne({ flowId }).exec();
  }

  async update(id: string, data: Partial<SetupPayload>): Promise<Setup> {
    const updated = await this.setupModel
      .findByIdAndUpdate(id, data, { new: true })
      .exec();
    if (!updated) throw new NotFoundException(`Setup with ID ${id} not found`);
    return updated;
  }

  async upsertByFlowId(flowId: string, elements: any[]): Promise<Setup> {
    // upsert returns the document, but findOneAndUpdate signature can include null if not found (unlikely with upsert: true)
    // Casting or handling as non-null is usually safe with upsert: true and new: true
    const result = await this.setupModel.findOneAndUpdate(
      { flowId },
      { elements },
      { upsert: true, new: true }
    ).exec();
    
    // Since upsert is true, result should theoretically not be null
    return result as Setup;
  }

  async delete(id: string): Promise<void> {
    const result = await this.setupModel.findByIdAndDelete(id).exec();
    if (!result) throw new NotFoundException(`Setup with ID ${id} not found`);
  }

  async deleteByFlowId(flowId: string): Promise<void> {
    await this.setupModel.deleteOne({ flowId }).exec();
  }
}