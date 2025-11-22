import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';

import { FlowsController } from './flows.controller';
import { FlowsService } from './flows.service';
import { FlowBuilderService } from './flow-builder.service';

import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';
import { LogicController } from './logic.controller';
import { LogicService } from './logic.service';

import { Flow, FlowSchema } from './schemas/flow.schema';
import { Setup, SetupSchema } from './schemas/setup.schema';
import { Logic, LogicSchema } from './schemas/logic.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Flow.name, schema: FlowSchema },
      { name: Setup.name, schema: SetupSchema },
      { name: Logic.name, schema: LogicSchema },
    ]),
    AuthModule,
  ],
  controllers: [FlowsController, SetupController, LogicController],
  providers: [FlowsService, FlowBuilderService, SetupService, LogicService],
})
export class FlowsModule {}