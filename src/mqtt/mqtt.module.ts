import { Module, Global } from '@nestjs/common';
import { MqttService } from './mqtt.service';
import { MqttController } from './mqtt.controller';
import { PigeonModule } from '../pigeon-mqtt/pigeon.module';
import { Transport } from '../pigeon-mqtt/enum/pigeon.transport.enum';
import { DevicesModule } from '../devices/devices.module';

@Global()
@Module({
  imports: [
    DevicesModule,

    PigeonModule.forRoot({
      transport: Transport.TCP,
      port: 1883,
      id: 'nexusflow-broker',
      concurrency: 200,
      queueLimit: 200,
      maxClientsIdLength: 64,
      connectTimeout: 15000,
      heartbeatInterval: 60000,
    }),
  ],
  controllers: [MqttController],
  providers: [MqttService],
  exports: [MqttService],
})
export class MqttModule {}
