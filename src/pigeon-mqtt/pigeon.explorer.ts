import {
  Injectable,
  OnModuleInit,
  OnApplicationShutdown,
  Inject,
  Logger,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import {
  INSTANCE_BROKER,
  KEY_SUBSCRIBE_OPTIONS,
  KEY_SUBSCRIBER_PARAMS,
} from './pigeon.constant';
import { SystemTopics } from './enum/pigeon.topic.enum';
import type { MqttSubscriberParameter, PigeonBroker } from './pigeon.interface';
import { getTransform } from './pigeon.transfrom';

@Injectable()
export class PigeonExplorer implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('PigeonExplorer');

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
    @Inject(INSTANCE_BROKER) private readonly broker: PigeonBroker
  ) {}

  onModuleInit() {
    this.logger.log('Pigeon Explorer initialized');
    this.explore();
  }

  onApplicationShutdown() {
    // broker.close accepts an optional callback; provide an empty callback to be safe
    if (this.broker && typeof this.broker.close === 'function') {
      this.broker.close(() => {});
    }
  }

  explore() {
    const providers = this.discoveryService.getProviders();
    providers.forEach((wrapper) => {
      const rawInstance: unknown = wrapper.instance;
      if (!rawInstance || typeof rawInstance !== 'object') {
        return;
      }

      const instanceRecord = rawInstance as Record<string, unknown>;
      const instanceObject = instanceRecord as object;
      const prototype = Object.getPrototypeOf(instanceObject) as object | null;

      this.metadataScanner.scanFromPrototype(
        instanceObject,
        prototype ?? null,
        (key: string) => {
          const handler = instanceRecord[key];
          if (typeof handler !== 'function') {
            return;
          }

          const subscribeOptions = this.reflector.get<
            | string
            | string[]
            | RegExp
            | RegExp[]
            | { topic?: string | string[] | RegExp | RegExp[] }
          >(KEY_SUBSCRIBE_OPTIONS, handler);
          const parameters = this.reflector.get<MqttSubscriberParameter[]>(
            KEY_SUBSCRIBER_PARAMS,
            handler
          );

          const resolvedTopic =
            typeof subscribeOptions === 'object' &&
            subscribeOptions !== null &&
            'topic' in subscribeOptions
              ? (
                  subscribeOptions as {
                    topic: string | string[] | RegExp | RegExp[];
                  }
                ).topic
              : (subscribeOptions as string | string[] | RegExp | RegExp[]);

          if (resolvedTopic) {
            this.subscribe(
              resolvedTopic,
              parameters ?? [],
              instanceRecord,
              handler as (...args: unknown[]) => unknown
            );
          }
        }
      );
    });
  }

  subscribe(
    topic: string | RegExp | string[] | RegExp[],
    parameters: MqttSubscriberParameter[],
    instance: Record<string, unknown>,
    method: (...args: unknown[]) => unknown
  ) {
    if (
      typeof topic === 'string' &&
      Object.values(SystemTopics).some((systemTopic) => systemTopic === topic)
    ) {
      this.broker.on(topic, (...args: unknown[]) => {
        const params = this.mapParameters(parameters, args);
        method.apply(instance, params);
      });
      this.logger.log(`Subscribed to system event: ${topic}`);
    }
  }

  mapParameters(
    parameters: MqttSubscriberParameter[],
    args: unknown[]
  ): unknown[] {
    if (!parameters) return [];

    const params: unknown[] = [];

    parameters
      .sort((a, b) => a.index - b.index)
      .forEach((param) => {
        let value: unknown = null;

        if (param.type === 'payload') {
          const packet = args.find(
            (arg): arg is { payload: Buffer } =>
              typeof arg === 'object' && arg !== null && 'payload' in arg
          );
          if (packet) {
            const transformFn = getTransform(param.transform || 'text');
            value = transformFn(packet.payload);
          }
        } else if (param.type === 'client') {
          value = args.find(
            (arg): arg is { id: unknown } =>
              typeof arg === 'object' && arg !== null && 'id' in arg
          );
        } else if (param.type === 'packet') {
          value = args.find(
            (arg): arg is { cmd: unknown } =>
              typeof arg === 'object' && arg !== null && 'cmd' in arg
          );
        }

        if (value === null && args.length > 0) {
          value = args[0];
        }

        params[param.index] = value;
      });
    return params;
  }
}
