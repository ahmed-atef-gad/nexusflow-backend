import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Module as ModuleEntity, ModuleSchema } from './schemas/module.schema';
import { ModulesService } from './modules.service';
import { ModulesController } from './modules.controller';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../guards/auth/roles.guard';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ModuleEntity.name, schema: ModuleSchema }]),
    AuthModule,
    UsersModule,
  ],
  controllers: [ModulesController],
  providers: [ModulesService, RolesGuard],
})
export class ModulesModule {}
