import { Provider, Logger } from '@nestjs/common';
import Aedes from 'aedes';
import { createServer } from 'net';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { readFileSync } from 'fs';
import websocketStream from 'websocket-stream';
import { PigeonModuleOptions } from './pigeon.interface';
import { INSTANCE_BROKER, PIGEON_OPTION_PROVIDER } from './pigeon.constant';
import { Transport } from './enum/pigeon.transport.enum';

export function createClientProvider(): Provider {
  return {
    provide: INSTANCE_BROKER,
    useFactory: async (options: PigeonModuleOptions) => {
      const logger = new Logger('PigeonMqtt');
     
      const broker = new (Aedes as any)(options);

      const loadPem = (value?: string | Buffer) => {
        if (!value) return undefined;
        if (Buffer.isBuffer(value)) return value;
        if (value.includes('-----BEGIN')) return value;
        try {
          return readFileSync(value);
        } catch {
          return value;
        }
      };

      if (options.transport === Transport.TCP) {
        const server = createServer(broker.handle);
        server.listen(options.port || 1883, () => {
          logger.log('Pigeon MQTT Server listening on port ' + (options.port || 1883));
        });
      }

      if (options.ws?.enabled) {
        const wsPort = options.ws.port ?? 8884;
        const wsPath = options.ws.path ?? '/mqtt';
        const wsServer = createHttpServer();

        websocketStream.createServer({ server: wsServer, path: wsPath }, broker.handle);
        wsServer.listen(wsPort, () => {
          logger.log(`Pigeon MQTT WS Server listening on port ${wsPort} path ${wsPath}`);
        });
      }

      if (options.wss?.enabled) {
        const wssPort = options.wss.port ?? 8883;
        const wssPath = options.wss.path ?? '/mqtt';
        const tls = options.wss.tls ?? {};
        const tlsOptions = {
          key: loadPem(tls.key),
          cert: loadPem(tls.cert),
          ca: loadPem(tls.ca),
          passphrase: tls.passphrase,
        };

        if (!tlsOptions.key || !tlsOptions.cert) {
          logger.warn('Pigeon MQTT WSS disabled: missing TLS key or cert');
        } else {
          const wssServer = createHttpsServer(tlsOptions);
          websocketStream.createServer(
            { server: wssServer, path: wssPath },
            broker.handle
          );
          wssServer.listen(wssPort, () => {
            logger.log(`Pigeon MQTT WSS Server listening on port ${wssPort} path ${wssPath}`);
          });
        }
      }
      return broker;
    },
    inject: [PIGEON_OPTION_PROVIDER],
  };
}