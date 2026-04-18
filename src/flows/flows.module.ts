import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { DevicesModule } from '../devices/devices.module';
import { UsersModule } from '../users/users.module';

import { FlowsController } from './flows.controller';
import { FlowsService } from './flows.service';
import { FlowBuilderService } from './flow-builder.service';
import { UiController } from './ui.controller';
import { UiService } from './ui.service';

import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';
import { LogicController } from './logic.controller';
import { LogicService } from './logic.service';

import { Flow, FlowSchema } from './schemas/flow.schema';
import { Setup, SetupSchema } from './schemas/setup.schema';
import { Logic, LogicSchema } from './schemas/logic.schema';
import { Ui, UiSchema } from './schemas/ui.schema';
import { RolesGuard } from '../gaurds/auth/roles.guard';
import { OwnerGuard } from '../gaurds/auth/owner.guard';

@Module({
  imports: [
    forwardRef(() => FlowsModule),
    MongooseModule.forFeature([
      { name: Flow.name, schema: FlowSchema },
      { name: Setup.name, schema: SetupSchema },
      { name: Logic.name, schema: LogicSchema },
      { name: Ui.name, schema: UiSchema },
    ]),
    AuthModule,
    DevicesModule,
    UsersModule,
  ],
  controllers: [
    FlowsController,
    SetupController,
    LogicController,
    UiController,
  ],
  providers: [
    FlowsService,
    FlowBuilderService,
    SetupService,
    LogicService,
    UiService,
    RolesGuard,
    OwnerGuard,
  ],
  exports: [FlowsService, FlowBuilderService],
})
export class FlowsModule {}
