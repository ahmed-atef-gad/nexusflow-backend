import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from 'src/auth/auth.module';
import { FlowsModule } from 'src/flows/flows.module';
import { RolesGuard } from 'src/gaurds/auth/roles.guard';
import { UsersModule } from 'src/users/users.module';
import {
  FlowTemplate,
  FlowTemplateSchema,
} from './schemas/flow-template.schema';
import { FlowTemplatesController } from './flow-templates.controller';
import { FlowTemplatesService } from './flow-templates.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FlowTemplate.name, schema: FlowTemplateSchema },
    ]),
    AuthModule,
    UsersModule,
    FlowsModule,
  ],
  controllers: [FlowTemplatesController],
  providers: [FlowTemplatesService, RolesGuard],
  exports: [FlowTemplatesService],
})
export class FlowTemplatesModule {}


