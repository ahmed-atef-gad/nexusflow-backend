import { Inject, Injectable } from '@nestjs/common';
import { INSTANCE_BROKER } from './pigeon.constant';
import { PubPacket } from './pigeon.interface';

@Injectable()
export class PigeonService {
  constructor(@Inject(INSTANCE_BROKER) private readonly broker: any) {}

  publish(packet: PubPacket): Promise<PubPacket> {
    return new Promise<any>((resolve, reject) => {
      this.broker.publish(packet, (error) => {
        if (!error) {
          return resolve(packet);
        }
        return reject(error);
      });
    });
  }

  close(): Promise<string> {
    return new Promise<any>((resolve) => {
      this.broker.close(() => {
        resolve('success');
      });
    });
  }

  getBrokerInstance(): any {
    return this.broker;
  }
}
