import { Inject, Injectable } from '@nestjs/common';
import { INSTANCE_BROKER } from './pigeon.constant';
import { PigeonBroker, PubPacket } from './pigeon.interface';

@Injectable()
export class PigeonService {
  constructor(@Inject(INSTANCE_BROKER) private readonly broker: unknown) {}

  publish(packet: PubPacket): Promise<PubPacket> {
    return new Promise<PubPacket>((resolve, reject) => {
      const broker = this.broker as PigeonBroker;
      broker.publish(packet, (error?: unknown) => {
        if (!error) {
          return resolve(packet);
        }
        return reject(
          error instanceof Error ? error : new Error('Pigeon broker error')
        );
      });
    });
  }

  close(): Promise<string> {
    return new Promise<string>((resolve) => {
      const broker = this.broker as PigeonBroker;
      broker.close(() => {
        resolve('success');
      });
    });
  }

  getBrokerInstance(): PigeonBroker {
    return this.broker as PigeonBroker;
  }
}
