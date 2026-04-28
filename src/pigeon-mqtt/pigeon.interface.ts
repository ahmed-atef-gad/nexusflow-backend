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
  tls?: PigeonTlsOptions;
  ws?: PigeonWsOptions;
  wss?: PigeonWssOptions;
  [key: string]: unknown;
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

export interface PigeonTlsOptions {
  key?: string | Buffer;
  cert?: string | Buffer;
  ca?: string | Buffer;
  passphrase?: string;
}

export interface PigeonModuleAsyncOptions
  extends Pick<ModuleMetadata, 'imports'> {
  useExisting?: Type<PigeonOptionsFactory>;
  useClass?: Type<PigeonOptionsFactory>;
  useFactory?: (
    ...args: any[]
  ) => Promise<PigeonModuleOptions> | PigeonModuleOptions;
  // allow any provider type to be injected (e.g., ConfigService)
  inject?: Array<Type<unknown> | string | symbol>;
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

export type PubPacket = Record<string, unknown>;

export interface PigeonBroker {
  handle: (...args: unknown[]) => void;
  publish: (packet: PubPacket, callback: (error?: unknown) => void) => void;
  close: (callback?: () => void) => void;
  on: (event: string | RegExp, listener: (...args: unknown[]) => void) => void;
}
