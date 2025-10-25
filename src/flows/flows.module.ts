import { Module } from '@nestjs/common';
import { FlowsController } from './flows.controller';
import { FlowsService } from './flows.service';
import { MongooseModule } from '@nestjs/mongoose';
import { Flow, FlowSchema } from './schemas/flow.schema';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Flow.name, schema: FlowSchema },
    ]),
    AuthModule
  ],
  controllers: [FlowsController],
  providers: [FlowsService]
})
export class FlowsModule {}
