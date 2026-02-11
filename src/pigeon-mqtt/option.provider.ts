import { Provider, Logger, Type } from '@nestjs/common';
import { PigeonModuleAsyncOptions, PigeonModuleOptions, PigeonOptionsFactory } from './pigeon.interface';
import { PIGEON_OPTION_PROVIDER } from './pigeon.constant';

export function createOptionProviders(
  options: PigeonModuleAsyncOptions,
): Provider[] {
  if (options.useExisting || options.useFactory) {
    return [createOptionProvider(options)];
  }
  

  const useClass = options.useClass as Type<PigeonOptionsFactory>;

  return [
    createOptionProvider(options),
    {
      provide: useClass,
      useClass: useClass,
    },
  ];
}

export function createOptionProvider(
  options: PigeonModuleAsyncOptions,
): Provider {
  if (options.useFactory) {
    return {
      provide: PIGEON_OPTION_PROVIDER,
      useFactory: options.useFactory,
      inject: options.inject || [],
    };
  }

  
  const inject = [options.useExisting || options.useClass] as any[];

  return {
    provide: PIGEON_OPTION_PROVIDER,
    useFactory: async (optionsFactory: PigeonOptionsFactory) =>
      await optionsFactory.createPigeonOptions(),
    inject: inject,
  };
}

export function createLoggerProvider(options: PigeonModuleOptions | PigeonModuleAsyncOptions): Provider {
    return {
        provide: 'PIGEON_LOGGER_PROVIDER',
        useValue: new Logger('PigeonMqtt'),
    };
}