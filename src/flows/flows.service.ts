import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { isValidObjectId, Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Flow, FlowSchema } from './schemas/flow.schema';
import { CreateFlowDto } from './dto/create-flow.dto';
import { UpdateFlowDto } from './dto/update-flow.dto';
import { use } from 'passport';

@Injectable()
export class FlowsService {
  constructor(
    @InjectModel(Flow.name) private flowModel: Model<Flow>,
  ) {}

  async create(createFlowDto: CreateFlowDto, userId: string): Promise<Flow> {
    const createdFlow = new this.flowModel({ ...createFlowDto,
        userId: userId,
     });
    return createdFlow.save();
  }

  async findAll(): Promise<Flow[]> {
    return this.flowModel.find().exec();
  }

  async findAllByUser(userId: string): Promise<Flow[]> {
    return this.flowModel.find({ userId: userId }).exec();
  }

  async findOne(id: string, userId: string): Promise<Flow> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid id format');
    }
    const flow = await this.flowModel.findOne({ _id: id, userId: userId }).exec();
    if (!flow) {
      throw new NotFoundException(`Flow with ID ${id} not found`);
    }
    return flow;
  }

  async update(id: string, userId: string, updateFlowDto: UpdateFlowDto): Promise<Flow> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid id format');
    }
    const flow = await this.flowModel.findOneAndUpdate({ _id: id, userId: userId }, updateFlowDto, { new: true }).exec();
    if (!flow) {
      throw new NotFoundException(`Flow with ID ${id} not found`);
    }
    return flow;
  }

  async delete(id: string, userId: string): Promise<Flow> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid id format');
    }
    const flow = await this.flowModel.findOneAndDelete({ _id: id, userId: userId }).exec();
    if (!flow) {
      throw new NotFoundException(`Flow with ID ${id} not found`);
    }
    return flow;
  }
}
