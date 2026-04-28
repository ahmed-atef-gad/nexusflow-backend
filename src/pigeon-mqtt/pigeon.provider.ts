/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { Provider, Logger } from '@nestjs/common';
import { Aedes } from 'aedes';
import * as net from 'net';
import { createServer as createTlsServer } from 'tls';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { readFileSync, statSync } from 'fs';
import websocketStream from 'websocket-stream';
import {
  PigeonBroker,
  PigeonModuleOptions,
  PigeonTlsOptions,
} from './pigeon.interface';
import { INSTANCE_BROKER, PIGEON_OPTION_PROVIDER } from './pigeon.constant';
import { Transport } from './enum/pigeon.transport.enum';

export function createClientProvider(): Provider {
  return {
    provide: INSTANCE_BROKER,
    useFactory: async (options: PigeonModuleOptions) => {
      const logger = new Logger('PigeonMqtt');

      const broker = (await Aedes.createBroker(
        options as unknown as PigeonModuleOptions
      )) as unknown as PigeonBroker;
      const brokerHandle = broker.handle.bind(broker) as (
        ...args: unknown[]
      ) => void;

      const loadPem = (
        value?: string | Buffer,
        label?: string
      ): Buffer | string | undefined => {
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
          const stats = statSync(value);
          if (!stats.isFile()) {
            logger.warn(
              `Pigeon MQTT TLS: ${label} path ${value} is not a file`
            );
            return undefined;
          }
          return readFileSync(value);
        } catch (error: unknown) {
          if (label) {
            const message =
              error instanceof Error ? error.message : String(error);
            logger.warn(
              `Pigeon MQTT TLS: failed to read ${label} from ${value}: ${message}`
            );
          }
          return undefined;
        }
      };

      if (options.transport === Transport.TCP) {
        const port = options.port || 1883;
        const tlsConfig: PigeonTlsOptions = options.tls ?? {};
        const tlsOptions = {
          key: loadPem(tlsConfig.key, 'key'),
          cert: loadPem(tlsConfig.cert, 'cert'),
          ca: loadPem(tlsConfig.ca, 'ca'),
          passphrase: tlsConfig.passphrase,
        };

        logger.log(
          `Pigeon MQTT TLS config: key=${!!tlsConfig.key} cert=${!!tlsConfig.cert} ca=${!!tlsConfig.ca} passphrase=${!!tlsConfig.passphrase}`
        );

        if (tlsOptions.key && tlsOptions.cert) {
          // createTlsServer typing can be tricky here due to runtime-loaded PEMs

          const tlsServer = createTlsServer(tlsOptions as any, brokerHandle);
          tlsServer.listen(port, () => {
            logger.log('Pigeon MQTT TLS Server listening on port ' + port);
          });
        } else {
          if (
            tlsConfig.key ||
            tlsConfig.cert ||
            tlsConfig.ca ||
            tlsConfig.passphrase
          ) {
            logger.warn(
              'Pigeon MQTT TLS disabled: missing TLS key or cert (check file paths and permissions)'
            );
          }
          const server = net.createServer(brokerHandle);
          server.listen(port, () => {
            logger.log('Pigeon MQTT Server listening on port ' + port);
          });
        }
      }

      if (options.ws?.enabled) {
        const wsPort = options.ws.port ?? 8884;
        const wsPath = options.ws.path ?? '/mqtt';
        const wsServer = createHttpServer();

        // websocket-stream accepts a server and a handler; brokerHandle is untyped at runtime

        websocketStream.createServer(
          { server: wsServer, path: wsPath },
          brokerHandle
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
        const wssTlsConfig: PigeonTlsOptions = options.wss.tls ?? {};
        const tlsOptions = {
          key: loadPem(wssTlsConfig.key, 'wss key'),
          cert: loadPem(wssTlsConfig.cert, 'wss cert'),
          ca: loadPem(wssTlsConfig.ca, 'wss ca'),
          passphrase: wssTlsConfig.passphrase,
        };

        if (!tlsOptions.key || !tlsOptions.cert) {
          logger.warn('Pigeon MQTT WSS disabled: missing TLS key or cert');
        } else {
          const wssServer = createHttpsServer(tlsOptions as any);

          websocketStream.createServer(
            { server: wssServer, path: wssPath },
            brokerHandle
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
