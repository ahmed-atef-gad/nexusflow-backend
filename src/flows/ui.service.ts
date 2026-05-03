import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ui, UiDocument } from './schemas/ui.schema';
import { UiPayload } from './types/flow.types';
import { UiItem } from './schemas/uiItem.schema';
import { TopicsData } from './flow-builder.service';

@Injectable()
export class UiService {
  constructor(@InjectModel(Ui.name) private uiModel: Model<UiDocument>) {}

  async create(data: UiPayload): Promise<Ui> {
    const created = new this.uiModel(data);
    return created.save();
  }

  async upsertByFlowId(
    flowId: string,
    uiItems: UiItem[],
    topics?: TopicsData
  ): Promise<Ui> {
    const result = await this.uiModel
      .findOneAndUpdate(
        { flowId },
        { uiItems, ...topics },
        { upsert: true, new: true }
      )
      .exec();
    return result as Ui;
  }

  async findByFlowId(flowId: string) {
    return this.uiModel.findOne({ flowId }).exec();
  }

  buildTopicsForUi(dedicatedMac?: string | null): TopicsData {
    const resolvedMac = this.normalizeMacAddress(dedicatedMac);
    return {
      commandTopic: resolvedMac ? `esp/${resolvedMac}/cmd` : undefined,
      resetWifiTopic: resolvedMac ? `esp/${resolvedMac}/resetwifi` : undefined,
      instantExecutionTopic: resolvedMac
        ? `esp/${resolvedMac}/instant`
        : undefined,
      functionErrorTopicPattern: resolvedMac
        ? `/devices/${resolvedMac}/logic/error/+`
        : undefined,
      logicDebugTopic: resolvedMac
        ? `/devices/${resolvedMac}/logic/debug`
        : undefined,
    };
  }

  private normalizeMacAddress(macAddress?: string | null): string | undefined {
    if (!macAddress) return undefined;
    const trimmed = macAddress.trim();
    if (!trimmed) return undefined;
    return trimmed.toUpperCase();
  }
}
