import { CustomDecorator, SetMetadata } from '@nestjs/common';
import {
  KEY_SUBSCRIBE_OPTIONS,
  KEY_SUBSCRIBER_PARAMS,
} from './pigeon.constant';
import {
  MqttMessageTransformer,
  MqttSubscribeOptions,
  MqttSubscriberParameter,
} from './pigeon.interface';
import { SystemTopics } from './enum/pigeon.topic.enum';

export function ListenOn(
  topic: string | string[] | RegExp | RegExp[] | MqttSubscribeOptions
): CustomDecorator;

export function ListenOn(
  topicOrOptions: string | string[] | RegExp | RegExp[] | MqttSubscribeOptions
): CustomDecorator {
  if (typeof topicOrOptions === 'string' || Array.isArray(topicOrOptions)) {
    return SetMetadata(KEY_SUBSCRIBE_OPTIONS, topicOrOptions);
  } else {
    return SetMetadata(KEY_SUBSCRIBE_OPTIONS, topicOrOptions);
  }
}

export function onHeartBeat(): CustomDecorator {
  return SetMetadata(KEY_SUBSCRIBE_OPTIONS, SystemTopics.HEART_BEAT);
}

function SetParameter(parameter: Partial<MqttSubscriberParameter>) {
  return (target: object, propertyKey: string | symbol, paramIndex: number) => {
    const method = (target as Record<string | symbol, object>)[propertyKey];
    const params =
      (Reflect.getMetadata(KEY_SUBSCRIBER_PARAMS, method) as
        | MqttSubscriberParameter[]
        | undefined) ?? [];
    const rest = parameter as Omit<MqttSubscriberParameter, 'index'>;
    params.push({
      index: paramIndex,
      ...rest,
    });
    Reflect.defineMetadata(KEY_SUBSCRIBER_PARAMS, params, method);
  };
}

export function Topic() {
  return SetParameter({ type: 'topic' });
}
export function Payload(
  transform?: 'json' | 'text' | MqttMessageTransformer<unknown>
) {
  return SetParameter({ type: 'payload', transform });
}
export function Client() {
  return SetParameter({ type: 'client' });
}
export function Packet() {
  return SetParameter({ type: 'packet' });
}
export function Subscription() {
  return SetParameter({ type: 'subscription' });
}
export function Subscriptions() {
  return SetParameter({ type: 'subscriptions' });
}
export function Unsubscription() {
  return SetParameter({ type: 'unsubscription' });
}
export function Function() {
  return SetParameter({ type: 'function' });
}
export function Credential() {
  return SetParameter({ type: 'credential' });
}
export function Host() {
  return SetParameter({ type: 'host' });
}
export function Error() {
  return SetParameter({ type: 'error' });
}
