import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PigeonService } from '../pigeon-mqtt/pigeon.service';

@Injectable()
export class MqttHandlers implements OnModuleInit {
  private readonly logger = new Logger(MqttHandlers.name);
  private readonly acceptedPairs = [
    { username: 'user1', password: 'pass1' },
    { username: 'user2', password: 'pass2' },
  ];

  constructor(private readonly pigeonService: PigeonService) {}

  onModuleInit() {
    const broker = this.pigeonService.getBrokerInstance();
    broker.authenticate = this.onAuthenticate.bind(this);
  }

  private onAuthenticate(
    client: any,
    username: Buffer | string | undefined,
    password: Buffer | string | undefined,
    done: (error: Error | null, success?: boolean) => void,
  ) {
    const usernameText = Buffer.isBuffer(username)
      ? username.toString()
      : (username ?? '').toString();
    const passwordText = Buffer.isBuffer(password)
      ? password.toString()
      : (password ?? '').toString();

    const isAccepted = this.acceptedPairs.some(
      (pair) =>
        pair.username === usernameText && pair.password === passwordText,
    );

    if (!isAccepted) {
      this.logger.warn(
        `MQTT auth rejected. clientId=${client?.id ?? 'unknown'} username=${usernameText || '(empty)'}`,
      );
      const error = new Error('Auth error') as Error & { returnCode?: number };
      error.returnCode = 4;
      return done(error, false);
    }

    this.logger.log(
      `MQTT auth accepted. clientId=${client?.id ?? 'unknown'} username=${usernameText}`,
    );
    return done(null, true);
  }
}
