import { Provider, Logger } from '@nestjs/common';
import Aedes from 'aedes';
import { createServer } from 'net';
import { PigeonModuleOptions } from './pigeon.interface';
import { INSTANCE_BROKER, PIGEON_OPTION_PROVIDER } from './pigeon.constant';
import { Transport } from './enum/pigeon.transport.enum';

export function createClientProvider(): Provider {
  return {
    provide: INSTANCE_BROKER,
    useFactory: async (options: PigeonModuleOptions) => {
      const logger = new Logger('PigeonMqtt');
     
      const broker = new (Aedes as any)(options);

      if (options.transport === Transport.TCP) {
        const server = createServer(broker.handle);
        server.listen(options.port || 1883, () => {
          logger.log('Pigeon MQTT Server listening on port ' + (options.port || 1883));
        });
      }
      return broker;
    },
    inject: [PIGEON_OPTION_PROVIDER],
  };
}