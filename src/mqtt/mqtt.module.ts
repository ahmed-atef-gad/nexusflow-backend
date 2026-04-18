import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MqttService } from './mqtt.service';
import { MqttController } from './mqtt.controller';
import { PigeonModule } from '../pigeon-mqtt/pigeon.module';
import { Transport } from '../pigeon-mqtt/enum/pigeon.transport.enum';
import { DevicesModule } from '../devices/devices.module';
import { MqttHandlers } from './mqtt.handlers';
import { UsersModule } from '../users/users.module';
import { MongooseModule } from '@nestjs/mongoose';
import { Logic, LogicSchema } from '../flows/schemas/logic.schema';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../gaurds/auth/roles.guard';

@Global()
@Module({
  imports: [
    DevicesModule,
    UsersModule,
    AuthModule,
    MongooseModule.forFeature([{ name: Logic.name, schema: LogicSchema }]),
    PigeonModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
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
          port:
            Number.parseInt(configService.get('MQTT_WS_PORT', ''), 10) || 8885,
          path: configService.get('MQTT_WS_PATH', '/mqtt-ws'),
        },
        tls: {
          key:
            configService.get('MQTT_TLS_KEY') ||
            configService.get('MQTT_WSS_KEY'),
          cert:
            configService.get('MQTT_TLS_CERT') ||
            configService.get('MQTT_WSS_CERT'),
          ca:
            configService.get('MQTT_TLS_CA') ||
            configService.get('MQTT_WSS_CA'),
          passphrase:
            configService.get('MQTT_TLS_PASSPHRASE') ||
            configService.get('MQTT_WSS_PASSPHRASE'),
        },
      }),
    }),
  ],

  controllers: [MqttController],
  providers: [MqttService, MqttHandlers, RolesGuard],
  exports: [MqttService, MqttHandlers],
})
export class MqttModule {}
