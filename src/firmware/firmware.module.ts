import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { DevicesModule } from '../devices/devices.module';
import { RolesGuard } from '../gaurds/auth/roles.guard';
import { UsersModule } from '../users/users.module';
import { FirmwareController } from './firmware.controller';
import { FirmwareService } from './firmware.service';
import { Firmware, FirmwareSchema } from './schemas/firmware.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Firmware.name, schema: FirmwareSchema }]),
    AuthModule,
    DevicesModule,
    UsersModule,
  ],
  controllers: [FirmwareController],
  providers: [FirmwareService, RolesGuard],
})
export class FirmwareModule {}
