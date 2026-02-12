import { Module, Global } from '@nestjs/common';
import { MqttService } from './mqtt.service';
import { MqttController } from './mqtt.controller';
import { PigeonModule } from '../pigeon-mqtt/pigeon.module';
import { Transport } from '../pigeon-mqtt/enum/pigeon.transport.enum';
import { DevicesModule } from '../devices/devices.module';
import { MqttHandlers } from './mqtt.handlers';

@Global()
@Module({
  imports: [
    DevicesModule,

    PigeonModule.forRoot({
      transport: Transport.TCP,
      port: 8883,
      id: 'nexusflow-broker',
      concurrency: 200,
      queueLimit: 200,
      maxClientsIdLength: 64,
      connectTimeout: 15000,
      heartbeatInterval: 60000,
      ws: {
        enabled: true,
        port: Number.parseInt(process.env.MQTT_WS_PORT || '', 10) || 8884,
        path: process.env.MQTT_WS_PATH || '/mqtt-ws',
      },
      tls: {
        key: process.env.MQTT_TLS_KEY || process.env.MQTT_WSS_KEY,
        cert: process.env.MQTT_TLS_CERT || process.env.MQTT_WSS_CERT,
        ca: process.env.MQTT_TLS_CA || process.env.MQTT_WSS_CA,
        passphrase:
          process.env.MQTT_TLS_PASSPHRASE || process.env.MQTT_WSS_PASSPHRASE,
      },
    }),
  ],

  controllers: [MqttController],
  providers: [MqttService, MqttHandlers],
  exports: [MqttService],
})
export class MqttModule {}
