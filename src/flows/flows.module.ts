import { Module } from '@nestjs/common';
import { FlowsController } from './flows.controller';
import { FlowsService } from './flows.service';
import { MongooseModule } from '@nestjs/mongoose';
import { Flow, FlowSchema } from './schemas/flow.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Flow.name, schema: FlowSchema },
    ]),
  ],
  controllers: [FlowsController],
  providers: [FlowsService]
})
export class FlowsModule {}
