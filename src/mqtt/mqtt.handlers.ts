import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PigeonService } from '../pigeon-mqtt/pigeon.service';
import { DevicesService } from '../devices/devices.service';
import { MqttService } from './mqtt.service';

@Injectable()
export class MqttHandlers implements OnModuleInit {
  private readonly logger = new Logger(MqttHandlers.name);

  constructor(
    private readonly pigeonService: PigeonService,
    private readonly devicesService: DevicesService,
    private readonly mqttService: MqttService
  ) {}

  onModuleInit() {
    const broker = this.pigeonService.getBrokerInstance();
    broker.authenticate = this.onAuthenticate.bind(this);
    broker.authorizePublish = this.onAuthorizePublish.bind(this);
    broker.authorizeSubscribe = this.onAuthorizeSubscribe.bind(this);
    broker.authorizeForward = this.onAuthorizeForward.bind(this);
    broker.on('clientDisconnect', this.onClientDisconnect.bind(this));
    broker.on('publish', (packet: any, client: any) => {
      this.logger.log(
        `MQTT message published. client=${client ? `clientId=${client.id} mac=${client.deviceMac ?? '(no mac)'}` : 'unknown'} topic=${packet?.topic ?? '(no topic)'}`
      );
    });
  }

  private normalizeMacAddress(value: string): string {
    return value.trim().toUpperCase();
  }

  private isDevicesTopic(topic: string): boolean {
    return topic.startsWith('/devices') || topic.startsWith('devices/');
  }

  private isAuthorizedForDevicesTopic(
    clientMac: string,
    topic: string
  ): boolean {
    const normalizedClientMac = this.normalizeMacAddress(clientMac);
    const segments = topic.split('/').filter(Boolean);

    // Expected shape for protected topics: /devices/{macAddress}/...
    if (segments.length < 2 || segments[0] !== 'devices') return false;

    const topicMac = this.normalizeMacAddress(segments[1]);
    return topicMac === normalizedClientMac;
  }

  private subscriptionMayMatchDevicesTopic(filter: string): boolean {
    const normalized = (filter ?? '').trim();
    if (!normalized) return false;

    const segments = normalized.split('/').filter(Boolean);
    if (segments.length === 0) {
      return normalized.includes('#') || normalized.includes('+');
    }

    const first = segments[0];
    return first === 'devices' || first === '+' || first === '#';
  }

  private isAuthorizedDevicesSubscriptionFilter(
    clientMac: string,
    filter: string
  ): boolean {
    const normalizedClientMac = this.normalizeMacAddress(clientMac);
    const segments = (filter ?? '').split('/').filter(Boolean);

    // Allowed protected filter shape: /devices/{clientMac}/...
    if (segments.length < 2 || segments[0] !== 'devices') return false;
    if (segments[1] === '+' || segments[1] === '#') return false;

    const filterMac = this.normalizeMacAddress(segments[1]);
    return filterMac === normalizedClientMac;
  }

  private async onAuthenticate(
    client: any,
    username: Buffer | string | undefined,
    password: Buffer | string | undefined,
    done: (error: Error | null, success?: boolean) => void
  ) {
    try {
      const macAddress = Buffer.isBuffer(username)
        ? username.toString()
        : (username ?? '').toString();
      const mqttPass = Buffer.isBuffer(password)
        ? password.toString()
        : (password ?? '').toString();

      const device = await this.devicesService.authenticateByMacAndPassword(
        macAddress,
        mqttPass
      );

      if (!device || device.status === 'revoked') {
        this.logger.warn(
          `MQTT auth rejected. clientId=${client?.id ?? 'unknown'} mac=${macAddress || '(empty)'}`
        );
        const error = new Error('Auth error') as Error & {
          returnCode?: number;
        };
        error.returnCode = 4;
        return done(error, false);
      }

      this.logger.log(
        `MQTT auth accepted. clientId=${client?.id ?? 'unknown'} mac=${device.macAddress}`
      );
      client.deviceMac = this.normalizeMacAddress(device.macAddress);
      return done(null, true);
    } catch (error) {
      this.logger.error(
        `MQTT auth failed with internal error. clientId=${client?.id ?? 'unknown'}`
      );
      return done(error as Error, false);
    }
  }

  private onAuthorizePublish(
    client: any,
    packet: { topic: string },
    done: (error: Error | null) => void
  ) {
    const topic = packet?.topic ?? '';

    if (!this.isDevicesTopic(topic)) {
      return done(null);
    }

    const clientMac = client?.deviceMac;
    if (!clientMac || !this.isAuthorizedForDevicesTopic(clientMac, topic)) {
      this.logger.warn(
        `MQTT publish rejected. clientId=${client?.id ?? 'unknown'} topic=${topic}`
      );
      return done(new Error('Not authorized'));
    }

    return done(null);
  }

  private onAuthorizeSubscribe(
    client: any,
    sub: { topic: string; qos?: 0 | 1 | 2 },
    done: (
      error: Error | null,
      granted?: { topic: string; qos?: 0 | 1 | 2 } | null
    ) => void
  ) {
    const topic = sub?.topic ?? '';
    const clientMac = client?.deviceMac;

    // Allow broad filters like "#" and rely on authorizeForward for per-message isolation.
    if (topic.includes('#') || topic.includes('+')) {
      return done(null, sub);
    }

    // Enforce ownership only for direct devices path subscriptions.
    if (
      this.isDevicesTopic(topic) &&
      (!clientMac ||
        !this.isAuthorizedDevicesSubscriptionFilter(clientMac, topic))
    ) {
      this.logger.warn(
        `MQTT subscribe rejected. clientId=${client?.id ?? 'unknown'} topic=${topic}`
      );
      return done(null, null);
    }

    return done(null, sub);
  }

  private onAuthorizeForward(client: any, packet: { topic?: string }) {
    const topic = packet?.topic ?? '';
    if (!this.isDevicesTopic(topic)) return packet;

    const clientMac = client?.deviceMac;
    if (!clientMac || !this.isAuthorizedForDevicesTopic(clientMac, topic)) {
      this.logger.warn(
        `MQTT forward blocked. clientId=${client?.id ?? 'unknown'} topic=${topic}`
      );
      return null;
    }

    return packet;
  }
  private async onClientDisconnect(client: any) {
    const clientId = client?.id?.toString?.() ?? '';
    if (clientId) {
      await this.mqttService.publish(`client/${clientId}/online`, {
        online: false,
        timestamp: new Date().toISOString(),
      });
      this.logger.debug(`MQTT client disconnected. clientId=${clientId}`);
    }
  }
}
