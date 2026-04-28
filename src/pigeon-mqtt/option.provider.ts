import { Provider, Logger, Type } from '@nestjs/common';
import {
  PigeonModuleAsyncOptions,
  PigeonOptionsFactory,
} from './pigeon.interface';
import { PIGEON_OPTION_PROVIDER } from './pigeon.constant';

export function createOptionProviders(
  options: PigeonModuleAsyncOptions
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
  options: PigeonModuleAsyncOptions
): Provider {
  if (options.useFactory) {
    return {
      provide: PIGEON_OPTION_PROVIDER,
      useFactory: options.useFactory,
      inject: options.inject || [],
    };
  }

  const inject = [options.useExisting || options.useClass].filter(
    Boolean
  ) as Array<Type<PigeonOptionsFactory>>;

  return {
    provide: PIGEON_OPTION_PROVIDER,
    useFactory: (optionsFactory: PigeonOptionsFactory) =>
      optionsFactory.createPigeonOptions(),
    inject: inject,
  };
}

export function createLoggerProvider(): Provider {
  return {
    provide: 'PIGEON_LOGGER_PROVIDER',
    useValue: new Logger('PigeonMqtt'),
  };
}
