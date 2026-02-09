import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ui, UiDocument } from './schemas/ui.schema';
import { UiPayload } from './types/flow.types';

@Injectable()
export class UiService {
  constructor(@InjectModel(Ui.name) private uiModel: Model<UiDocument>) {}

  async create(data: UiPayload): Promise<Ui> {
    const created = new this.uiModel(data);
    return created.save();
  }

  async upsertByFlowId(flowId: string, elements: any[]): Promise<Ui> {
    const result = await this.uiModel
      .findOneAndUpdate({ flowId }, { elements }, { upsert: true, new: true })
      .exec();
    return result as Ui;
  }

  async findByFlowId(flowId: string) {
    return this.uiModel.findOne({ flowId }).exec();
  }
}
