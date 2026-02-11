import { Injectable, OnModuleInit, OnApplicationShutdown, Inject, Logger } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { INSTANCE_BROKER, KEY_SUBSCRIBE_OPTIONS, KEY_SUBSCRIBER_PARAMS } from './pigeon.constant';
import { SystemTopics } from './enum/pigeon.topic.enum';
import { MqttSubscriberParameter } from './pigeon.interface';
import { getTransform } from './pigeon.transfrom';

@Injectable()
export class PigeonExplorer implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('PigeonExplorer');

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
    @Inject(INSTANCE_BROKER) private readonly broker: any,
  ) {}

  onModuleInit() {
    this.logger.log('Pigeon Explorer initialized');
    this.explore();
  }

  onApplicationShutdown(signal?: string) {
    this.broker.close();
  }

  explore() {
    const providers = this.discoveryService.getProviders();
    providers.forEach((wrapper) => {
      const { instance } = wrapper;
      if (!instance || typeof instance !== 'object') {
        return;
      }
      
      this.metadataScanner.scanFromPrototype(
        instance,
        Object.getPrototypeOf(instance),
        (key) => {
          const subscribeOptions = this.reflector.get(KEY_SUBSCRIBE_OPTIONS, instance[key]);
          const parameters = this.reflector.get(KEY_SUBSCRIBER_PARAMS, instance[key]);
          
          if (subscribeOptions) {
            this.subscribe(subscribeOptions, parameters, instance, instance[key]);
          }
        },
      );
    });
  }

  subscribe(topic: string | any, parameters: MqttSubscriberParameter[], instance: any, method: Function) {
    if (typeof topic === 'string' && Object.values(SystemTopics).includes(topic as any)) {
      this.broker.on(topic, (...args: any[]) => {
        const params = this.mapParameters(parameters, args);
        method.apply(instance, params);
      });
      this.logger.log(`Subscribed to system event: ${topic}`);
    }
  }

  mapParameters(parameters: MqttSubscriberParameter[], args: any[]) {
    if (!parameters) return [];
    
   
    const params: any[] = [];
    
    parameters.sort((a, b) => a.index - b.index).forEach((param) => {
      let value = null;

    
      if (param.type === 'payload') {
          const packet = args.find(arg => arg && arg.payload);
          if (packet) {
              const transformFn = getTransform(param.transform || 'text'); 
              value = transformFn(packet.payload);
          }
      } else if (param.type === 'client') {
          value = args.find(arg => arg && arg.id);
      } else if (param.type === 'packet') {
          value = args.find(arg => arg && arg.cmd);
      }
      
      if (value === null && args.length > 0) {
          value = args[0];
      }

      params[param.index] = value;
    });
    return params;
  }
}