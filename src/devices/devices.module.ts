import { Module , forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';
import { Device, DeviceSchema } from './schemas/device.schema';
import { DeviceToken, DeviceTokenSchema } from './schemas/device-token.schema';
import { DeviceAudit, DeviceAuditSchema } from './schemas/device-audit.schema';
import { DeviceAuthGuard } from '../gaurds/device-auth.guard';
import { AuthModule } from '../auth/auth.module';
import { FlowsModule } from 'src/flows/flows.module';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [
     forwardRef(() => FlowsModule),
    MongooseModule.forFeature([
      { name: Device.name, schema: DeviceSchema },
      { name: DeviceToken.name, schema: DeviceTokenSchema },
      { name: DeviceAudit.name, schema: DeviceAuditSchema },
    ]),
    AuthModule,
    UsersModule,
  ],
  
  controllers: [DevicesController],
  providers: [DevicesService, DeviceAuthGuard],
  exports: [DevicesService, DeviceAuthGuard], 
})
export class DevicesModule {}
