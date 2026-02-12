import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Setup, SetupDocument } from './schemas/setup.schema';
import { SetupPayload } from './types/flow.types';
import { Flow, FlowDocument } from './schemas/flow.schema';
import { DeviceDocument } from 'src/devices/schemas/device.schema';

@Injectable()
export class SetupService {
  constructor(
    @InjectModel(Setup.name) private setupModel: Model<SetupDocument>,
    @InjectModel(Flow.name) private flowModel: Model<FlowDocument>
  ) {}

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

  // async findForDeviceContext(device: {
  //   macAddress?: string;
  //   flowId?: string;
  //   ownerId?: unknown;
  // }): Promise<Setup | null> {
  //   if (!device) return null;

  //   if (device.flowId) {
  //     return this.setupModel.findOne({ flowId: device.flowId }).exec();
  //   }

  //   const normalizedMac = device.macAddress?.trim().toUpperCase();
  //   const ownerId = device.ownerId;
  //   let resolvedFlowId: string | null = null;

  //   if (normalizedMac) {
  //     const flowByMac = await this.flowModel
  //       .findOne({
  //         ...(ownerId ? { userId: ownerId } : {}),
  //         $or: [
  //           { 'nodes.data.variables.macAddress': normalizedMac },
  //           { 'nodes.data.variables.deviceMac': normalizedMac },
  //           { 'nodes.data.variables.mac': normalizedMac },
  //         ],
  //       })
  //       .sort({ updatedAt: -1 })
  //       .select('_id')
  //       .lean()
  //       .exec();

  //     if (flowByMac?._id) {
  //       resolvedFlowId = flowByMac._id.toString();
  //     }
  //   }

  //   if (!resolvedFlowId && ownerId) {
  //     const latestOwnerFlow = await this.flowModel
  //       .findOne({ userId: ownerId })
  //       .sort({ updatedAt: -1 })
  //       .select('_id')
  //       .lean()
  //       .exec();

  //     if (latestOwnerFlow?._id) {
  //       resolvedFlowId = latestOwnerFlow._id.toString();
  //     }
  //   }

  //   if (!resolvedFlowId) return null;

  //   return this.setupModel.findOne({ flowId: resolvedFlowId }).exec();
  // }
  async findForDeviceContext(device: DeviceDocument) {
  if (!device.activeFlowId) return null;
  return this.setupModel.findOne({ flowId: device.activeFlowId }).exec();
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
    const result = await this.setupModel
      .findOneAndUpdate({ flowId }, { elements }, { upsert: true, new: true })
      .exec();

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
