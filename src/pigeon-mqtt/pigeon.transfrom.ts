import { MqttMessageTransformer } from './pigeon.interface';

export function getTransform(
  transform: 'json' | 'text' | MqttMessageTransformer<unknown>,
) {
  if (typeof transform === 'function') {
    return transform;
  }
  if (transform === 'json') {
    return (payload: Buffer) => {
        if (!payload) return {}; // Fix: Handle undefined payload
        return JSON.parse(payload.toString('utf-8'));
    };
  }
  if (transform === 'text') {
    return (payload: Buffer) => {
        if (!payload) return ''; // Fix: Handle undefined payload
        return payload.toString('utf-8');
    };
  }
  return (payload: Buffer) => payload;
}