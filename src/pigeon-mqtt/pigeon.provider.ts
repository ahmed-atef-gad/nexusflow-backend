import { Provider, Logger } from '@nestjs/common';
import Aedes from 'aedes';
import { createServer } from 'net';
import { createServer as createTlsServer } from 'tls';
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
      const fs = require('fs');

      const loadPem = (value?: string | Buffer, label?: string) => {
        if (!value) return undefined;
        if (Buffer.isBuffer(value)) return value;
        if (typeof value === 'string' && value.includes('-----BEGIN'))
          return value;
        try {
          if (typeof value !== 'string') {
            logger.warn(
              `Pigeon MQTT TLS: ${label} is not a string (got ${typeof value})`
            );
            return value;
          }
          const stats = fs.statSync(value);
          if (!stats.isFile()) {
            logger.warn(
              `Pigeon MQTT TLS: ${label} path ${value} is not a file`
            );
            return undefined;
          }
          return readFileSync(value);
        } catch (error) {
          if (label) {
            logger.warn(
              `Pigeon MQTT TLS: failed to read ${label} from ${value}: ${(error as any).message}`
            );
          }
          return undefined;
        }
      };

      if (options.transport === Transport.TCP) {
        const port = options.port || 1883;
        const tls = options.tls ?? {};
        const tlsOptions = {
          key: loadPem(tls.key, 'key'),
          cert: loadPem(tls.cert, 'cert'),
          ca: loadPem(tls.ca, 'ca'),
          passphrase: tls.passphrase,
        };

        logger.log(
          `Pigeon MQTT TLS config: key=${!!tls.key} cert=${!!tls.cert} ca=${!!tls.ca} passphrase=${!!tls.passphrase}`
        );

        if (tlsOptions.key && tlsOptions.cert) {
          const tlsServer = createTlsServer(tlsOptions, broker.handle);
          tlsServer.listen(port, () => {
            logger.log('Pigeon MQTT TLS Server listening on port ' + port);
          });
        } else {
          if (tls.key || tls.cert || tls.ca || tls.passphrase) {
            logger.warn(
              'Pigeon MQTT TLS disabled: missing TLS key or cert (check file paths and permissions)'
            );
          }
          const server = createServer(broker.handle);
          server.listen(port, () => {
            logger.log('Pigeon MQTT Server listening on port ' + port);
          });
        }
      }

      if (options.ws?.enabled) {
        const wsPort = options.ws.port ?? 8884;
        const wsPath = options.ws.path ?? '/mqtt';
        const wsServer = createHttpServer();

        websocketStream.createServer(
          { server: wsServer, path: wsPath },
          broker.handle
        );
        wsServer.listen(wsPort, () => {
          logger.log(
            `Pigeon MQTT WS Server listening on port ${wsPort} path ${wsPath}`
          );
        });
      }

      if (options.wss?.enabled) {
        const wssPort = options.wss.port ?? 8883;
        const wssPath = options.wss.path ?? '/mqtt';
        const tls = options.wss.tls ?? {};
        const tlsOptions = {
          key: loadPem(tls.key, 'wss key'),
          cert: loadPem(tls.cert, 'wss cert'),
          ca: loadPem(tls.ca, 'wss ca'),
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
            logger.log(
              `Pigeon MQTT WSS Server listening on port ${wssPort} path ${wssPath}`
            );
          });
        }
      }
      return broker;
    },
    inject: [PIGEON_OPTION_PROVIDER],
  };
}
