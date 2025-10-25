import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Module as ModuleEntity, ModuleSchema } from './schemas/module.schema';
import { ModulesService } from './modules.service';
import { ModulesController } from './modules.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: ModuleEntity.name, schema: ModuleSchema }])],
  controllers: [ModulesController],
  providers: [ModulesService],
})
export class ModulesModule {}
