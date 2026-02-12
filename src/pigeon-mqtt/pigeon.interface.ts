import { ModuleMetadata, Type } from '@nestjs/common';
import { Transport } from './enum/pigeon.transport.enum';

export interface PigeonModuleOptions {
  transport?: Transport;
  port?: number;
  id?: string;
  concurrency?: number;
  queueLimit?: number;
  maxClientsIdLength?: number;
  connectTimeout?: number;
  heartbeatInterval?: number;
  ws?: PigeonWsOptions;
  wss?: PigeonWssOptions;
  [key: string]: any;
}

export interface PigeonWsOptions {
  enabled?: boolean;
  port?: number;
  path?: string;
}

export interface PigeonWssOptions extends PigeonWsOptions {
  tls?: {
    key?: string | Buffer;
    cert?: string | Buffer;
    ca?: string | Buffer;
    passphrase?: string;
  };
}

export interface PigeonModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  useExisting?: Type<PigeonOptionsFactory>;
  useClass?: Type<PigeonOptionsFactory>;
  useFactory?: (...args: any[]) => Promise<PigeonModuleOptions> | PigeonModuleOptions;
  inject?: any[];
}

export interface PigeonOptionsFactory {
  createPigeonOptions(): Promise<PigeonModuleOptions> | PigeonModuleOptions;
}

export interface MqttSubscribeOptions {
  topic: string | string[] | RegExp | RegExp[];
  queue?: boolean;
  share?: string;
  transform?: 'json' | 'text';
}

export interface MqttSubscriberParameter {
  index: number;
  type: string;
  transform?: 'json' | 'text' | MqttMessageTransformer<unknown>;
}

export type MqttMessageTransformer<T> = (payload: Buffer) => T;

export type PubPacket = any; 