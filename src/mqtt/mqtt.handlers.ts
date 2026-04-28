import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PigeonService } from '../pigeon-mqtt/pigeon.service';
import { DevicesService } from '../devices/devices.service';
import { UsersService } from '../users/users.service';
import { MqttService } from './mqtt.service';
import { LogicService } from '../flows/logic.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import * as vm from 'node:vm';
import type { PigeonBroker } from '../pigeon-mqtt/pigeon.interface';

type RuntimeBroker = PigeonBroker & {
  authenticate?: (
    client: unknown,
    username: string,
    password: Buffer,
    callback: (...args: unknown[]) => void
  ) => void;
  authorizePublish?: (...args: unknown[]) => void;
  authorizeSubscribe?: (...args: unknown[]) => void;
  authorizeForward?: (...args: unknown[]) => void;
  on: PigeonBroker['on'];
};

type OutputModuleType = 'pwm' | 'digital' | 'dac' | 'servo' | 'other';

type RuntimeCommand = {
  id?: string;
  moduleId?: string;
  stepType?: 'input' | 'function' | 'output';
  code?: string;
  targetModuleType?: OutputModuleType;
  cmd?: number;
  pin?: number;
  value?: number | string;
  topic?: string;
};

type RuntimeMessage = {
  payload: unknown;
  value: unknown;
  topic: string;
  nodeId: string;
  moduleId: string;
  flowId: string;
  device: {
    macAddress: string;
  };
  input: {
    payload: unknown;
    normalized: number | null;
    topic: string;
  };
  metadata: {
    timestamp: string;
  };
};

type MqttClientContext = {
  id?: string;
  deviceMac?: string;
  deviceId?: string;
  deviceName?: string;
  ownerId?: string;
  ownerUsername?: string;
  linkedFlowId?: string | null;
  isEsp?: boolean;
  isUserClient?: boolean;
  authorizedDeviceMacs?: string[];
  userId?: string;
  mqttUsername?: string;
  connectedAt?: Date;
};

type MqttPacketContext = {
  topic?: string;
  payload?: Buffer;
};

type InputPayload = {
  sensorType?: string;
  type?: string;
  result?: number | boolean;
  value?: number;
  digital?: number | boolean;
  analog?: number;
  motion?: number | boolean;
  raw?: number;
  percent?: number;
  temperature?: number;
  humidity?: number;
  distance_cm?: number;
};

const INPUT_TOPIC_PATTERN = /^logic\/input\/([^/]+)$/;
const LEGACY_INPUT_TOPIC_PATTERN = /^esp\/([^/]+)$/;
const DEFAULT_FUNCTION_NODE_EXECUTION_TIMEOUT_MS = 100;
const DEFAULT_FUNCTION_NODE_MAX_PAYLOAD_BYTES = 8192;
const MAX_RUNTIME_STEPS_PER_PATH = 64;
const MAX_RUNTIME_FUNCTION_STEPS_PER_PATH = 16;

@Injectable()
export class MqttHandlers implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttHandlers.name);
  private readonly functionExecutionTimeoutMs: number;
  private readonly functionNodeMaxPayloadBytes: number;
  private readonly activeEspSessions = new Map<string, string>();

  constructor(
    private readonly pigeonService: PigeonService,
    private readonly devicesService: DevicesService,
    private readonly usersService: UsersService,
    private readonly mqttService: MqttService,
    private readonly notificationsService: NotificationsService,
    private readonly logicService: LogicService,
    private readonly configService: ConfigService
  ) {
    this.functionExecutionTimeoutMs = this.readPositiveConfigNumber(
      'FUNCTION_NODE_EXECUTION_TIMEOUT_MS',
      DEFAULT_FUNCTION_NODE_EXECUTION_TIMEOUT_MS
    );
    this.functionNodeMaxPayloadBytes = this.readPositiveConfigNumber(
      'FUNCTION_NODE_MAX_PAYLOAD_BYTES',
      DEFAULT_FUNCTION_NODE_MAX_PAYLOAD_BYTES
    );
  }

  onModuleInit() {
    const broker = this.pigeonService.getBrokerInstance() as RuntimeBroker;
    broker.authenticate = this.onAuthenticate.bind(
      this
    ) as RuntimeBroker['authenticate'];
    broker.authorizePublish = this.onAuthorizePublish.bind(
      this
    ) as RuntimeBroker['authorizePublish'];
    broker.authorizeSubscribe = this.onAuthorizeSubscribe.bind(
      this
    ) as RuntimeBroker['authorizeSubscribe'];
    broker.authorizeForward = this.onAuthorizeForward.bind(
      this
    ) as RuntimeBroker['authorizeForward'];
    broker.on(
      'clientDisconnect',
      this.onClientDisconnect.bind(this) as (...args: unknown[]) => void
    );
    broker.on(
      'publish',
      this.onClientPublish.bind(this) as (...args: unknown[]) => void
    );

    // start logic cache sweeper in LogicService
    this.logicService.startLogicCacheSweeper();
  }

  onModuleDestroy() {
    this.logicService.stopLogicCacheSweeper();
  }

  private readPositiveConfigNumber(name: string, fallback: number): number {
    const raw = this.configService.get<string | number>(name);
    if (raw === undefined || raw === null || raw === '') return fallback;

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.trunc(parsed);
  }

  private normalizeMacAddress(value: string): string {
    return value.trim().toUpperCase();
  }
  private normalizeUsername(value: string): string {
    return value.trim();
  }

  private isMacAddress(value: string): boolean {
    return /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(value.trim());
  }

  private isDevicesTopic(topic: string): boolean {
    return topic.startsWith('/devices') || topic.startsWith('devices/');
  }
  private isEspTopic(topic: string): boolean {
    return topic.startsWith('esp/');
  }
  private extractDevicesTopicMac(topic: string): string | null {
    const segments = topic.split('/').filter(Boolean);
    if (segments.length < 2 || segments[0] !== 'devices') return null;
    if (segments[1] === '+' || segments[1] === '#') return null;
    return this.normalizeMacAddress(segments[1]);
  }

  private extractEspTopicMac(topic: string): string | null {
    const segments = topic.split('/').filter(Boolean);
    if (segments.length < 2 || segments[0] !== 'esp') return null;
    if (!this.isMacAddress(segments[1])) return null;
    return this.normalizeMacAddress(segments[1]);
  }

  private isAuthorizedForDevicesTopic(
    clientMac: string,
    topic: string
  ): boolean {
    const normalizedClientMac = this.normalizeMacAddress(clientMac);
    const topicMac = this.extractDevicesTopicMac(topic);
    return topicMac === normalizedClientMac;
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

  private isUserAuthorizedForDevicesTopic(
    client: MqttClientContext,
    topic: string
  ): boolean {
    const topicMac = this.extractDevicesTopicMac(topic);
    if (!topicMac) return false;

    const authorizedDeviceMacs = Array.isArray(client?.authorizedDeviceMacs)
      ? client.authorizedDeviceMacs
      : [];
    return authorizedDeviceMacs.includes(topicMac);
  }

  private isUserAuthorizedDevicesSubscriptionFilter(
    client: MqttClientContext,
    filter: string
  ): boolean {
    const topicMac = this.extractDevicesTopicMac(filter);
    if (!topicMac) return false;

    const authorizedDeviceMacs = Array.isArray(client?.authorizedDeviceMacs)
      ? client.authorizedDeviceMacs
      : [];
    return authorizedDeviceMacs.includes(topicMac);
  }

  private isAuthorizedForEspTopic(clientMac: string, topic: string): boolean {
    const normalizedClientMac = this.normalizeMacAddress(clientMac);
    const topicMac = this.extractEspTopicMac(topic);
    return topicMac === normalizedClientMac;
  }

  private isAuthorizedEspSubscriptionFilter(
    clientMac: string,
    filter: string
  ): boolean {
    const normalizedClientMac = this.normalizeMacAddress(clientMac);
    const topicMac = this.extractEspTopicMac(filter);
    return topicMac === normalizedClientMac;
  }

  private isUserAuthorizedForEspTopic(
    client: MqttClientContext,
    topic: string
  ): boolean {
    const topicMac = this.extractEspTopicMac(topic);
    if (!topicMac) return false;

    const authorizedDeviceMacs = Array.isArray(client?.authorizedDeviceMacs)
      ? client.authorizedDeviceMacs
      : [];
    return authorizedDeviceMacs.includes(topicMac);
  }

  private isUserAuthorizedEspSubscriptionFilter(
    client: MqttClientContext,
    filter: string
  ): boolean {
    const topicMac = this.extractEspTopicMac(filter);
    if (!topicMac) return false;

    const authorizedDeviceMacs = Array.isArray(client?.authorizedDeviceMacs)
      ? client.authorizedDeviceMacs
      : [];
    return authorizedDeviceMacs.includes(topicMac);
  }

  private rejectAuth(
    clientId: string,
    details: string,
    done: (error: Error | null, success?: boolean) => void
  ) {
    this.logger.warn(`MQTT auth rejected. clientId=${clientId} ${details}`);
    const error = new Error('Auth error') as Error & {
      returnCode?: number;
    };
    error.returnCode = 4;
    return done(error, false);
  }

  private reserveEspSession(deviceMac: string, clientId: string): boolean {
    const normalizedMac = this.normalizeMacAddress(deviceMac);
    const normalizedClientId = clientId.trim();
    const activeClientId = this.activeEspSessions.get(normalizedMac);

    if (!activeClientId) {
      this.activeEspSessions.set(normalizedMac, normalizedClientId);
      return true;
    }

    if (activeClientId === normalizedClientId) {
      return true;
    }

    if (!this.mqttService.isClientConnected(activeClientId)) {
      this.activeEspSessions.set(normalizedMac, normalizedClientId);
      return true;
    }

    return false;
  }

  private async onAuthenticate(
    client: MqttClientContext,
    username: Buffer | string | undefined,
    password: Buffer | string | undefined,
    done: (error: Error | null, success?: boolean) => void
  ) {
    try {
      const mqttUsernameRaw = Buffer.isBuffer(username)
        ? username.toString()
        : (username ?? '').toString();
      const mqttPasswordRaw = Buffer.isBuffer(password)
        ? password.toString()
        : (password ?? '').toString();
      const mqttUsername = this.normalizeUsername(mqttUsernameRaw);
      const mqttPassword = mqttPasswordRaw.trim();
      const clientId = (client?.id ?? '').toString().trim();

      if (!clientId || !mqttPassword) {
        return this.rejectAuth(
          clientId || 'unknown',
          'reason=missing credentials',
          done
        );
      }

      // ESP path: if clientId is a MAC address, this is an ESP client.
      if (this.isMacAddress(clientId)) {
        const normalizedClientMac = this.normalizeMacAddress(clientId);

        if (
          mqttUsername &&
          this.normalizeMacAddress(mqttUsername) !== normalizedClientMac
        ) {
          return this.rejectAuth(
            clientId,
            `reason=username mismatch expectedMac=${normalizedClientMac}`,
            done
          );
        }

        const device = await this.devicesService.authenticateByMacAndPassword(
          normalizedClientMac,
          mqttPassword
        );

        if (!device || device.status === 'revoked') {
          return this.rejectAuth(
            clientId,
            `reason=invalid device credentials mac=${normalizedClientMac}`,
            done
          );
        }

        if (!this.reserveEspSession(normalizedClientMac, clientId)) {
          return this.rejectAuth(
            clientId,
            `reason=device already has an active mqtt session mac=${normalizedClientMac}`,
            done
          );
        }

        const ownerId = device.ownerId?.toString();
        const deviceId = device._id?.toString();
        const deviceName = typeof device.name === 'string' ? device.name : null;
        let ownerUsername: string | undefined;
        if (ownerId) {
          const owner = await this.usersService.getUserById(ownerId);
          ownerUsername = owner?.username;
        }

        client.deviceMac = normalizedClientMac;
        client.deviceId = deviceId;
        client.deviceName = deviceName ?? undefined;
        client.ownerId = ownerId;
        client.ownerUsername = ownerUsername;
        client.linkedFlowId = device.activeFlowId?.toString() ?? null;
        client.isEsp = true;
        client.isUserClient = false;

        this.logger.log(
          `MQTT auth accepted. clientId=${clientId} type=esp mac=${normalizedClientMac}`
        );
        return done(null, true);
      }

      // // User path: mqtt clientId must match user username.
      // if (!mqttUsername || clientId !== mqttUsername) {
      //   return this.rejectAuth(
      //     clientId,
      //     `reason=clientId must equal mqtt username username=${mqttUsername || '(empty)'}`,
      //     done
      //   );
      // }

      const user = await this.usersService.authenticateMqttUser(
        mqttUsername,
        mqttPassword
      );
      if (!user || !user.is_active) {
        return this.rejectAuth(
          clientId,
          `reason=invalid user mqtt credentials username=${mqttUsername}`,
          done
        );
      }
      const userId = user._id?.toString();
      if (!userId) {
        return this.rejectAuth(
          clientId,
          `reason=invalid user id username=${mqttUsername}`,
          done
        );
      }

      const userDevices = await this.devicesService.findAllByUserIdRaw(userId);
      client.authorizedDeviceMacs = userDevices.map((device) =>
        this.normalizeMacAddress(device.macAddress)
      );
      client.isEsp = false;
      client.isUserClient = true;
      client.userId = userId;
      client.mqttUsername = user.username;

      this.logger.log(
        `MQTT auth accepted. clientId=${clientId} type=user username=${user.username}`
      );

      client.connectedAt = new Date();
      return done(null, true);
    } catch (error) {
      this.logger.error(
        `MQTT auth failed with internal error. clientId=${client?.id ?? 'unknown'}`
      );
      return done(error as Error, false);
    }
  }

  private onAuthorizePublish(
    client: MqttClientContext,
    packet: { topic: string },
    done: (error: Error | null) => void
  ) {
    const topic = packet?.topic ?? '';

    if (this.isDevicesTopic(topic)) {
      if (client?.isEsp) {
        const clientMac = client?.deviceMac;
        if (clientMac && this.isAuthorizedForDevicesTopic(clientMac, topic)) {
          return done(null);
        }
      }

      if (
        client?.isUserClient &&
        this.isUserAuthorizedForDevicesTopic(client, topic)
      ) {
        return done(null);
      }

      this.logger.warn(
        `MQTT publish rejected. clientId=${client?.id ?? 'unknown'} topic=${topic}`
      );
      return done(new Error('Not authorized'));
    }

    if (this.isEspTopic(topic)) {
      if (client?.isEsp) {
        const clientMac = client?.deviceMac;
        if (clientMac && this.isAuthorizedForEspTopic(clientMac, topic)) {
          return done(null);
        }
      }

      if (
        client?.isUserClient &&
        this.isUserAuthorizedForEspTopic(client, topic)
      ) {
        return done(null);
      }

      this.logger.warn(
        `MQTT publish rejected. clientId=${client?.id ?? 'unknown'} topic=${topic}`
      );
      return done(new Error('Not authorized'));
    }

    return done(null);
  }

  private onAuthorizeSubscribe(
    client: MqttClientContext,
    sub: { topic: string; qos?: 0 | 1 | 2 },
    done: (
      error: Error | null,
      granted?: { topic: string; qos?: 0 | 1 | 2 } | null
    ) => void
  ) {
    const topic = sub?.topic ?? '';

    if (
      this.isEspTopic(topic) &&
      (topic.includes('#') || topic.includes('+'))
    ) {
      if (client?.isEsp) {
        const clientMac = client?.deviceMac;
        if (
          clientMac &&
          this.isAuthorizedEspSubscriptionFilter(clientMac, topic)
        ) {
          return done(null, sub);
        }
      }

      if (
        client?.isUserClient &&
        this.isUserAuthorizedEspSubscriptionFilter(client, topic)
      ) {
        return done(null, sub);
      }

      this.logger.warn(
        `MQTT subscribe rejected. clientId=${client?.id ?? 'unknown'} topic=${topic}`
      );
      return done(null, null);
    }

    // For /devices/* topics with wildcard filter, enforce ownership by MAC.
    if (
      this.isDevicesTopic(topic) &&
      (topic.includes('#') || topic.includes('+'))
    ) {
      if (client?.isEsp) {
        const clientMac = client?.deviceMac;
        if (
          clientMac &&
          this.isAuthorizedDevicesSubscriptionFilter(clientMac, topic)
        ) {
          return done(null, sub);
        }
      }

      if (
        client?.isUserClient &&
        this.isUserAuthorizedDevicesSubscriptionFilter(client, topic)
      ) {
        return done(null, sub);
      }

      this.logger.warn(
        `MQTT subscribe rejected. clientId=${client?.id ?? 'unknown'} topic=${topic}`
      );
      return done(null, null);
    }

    // Allow wildcard filters on non-devices topics.
    if (topic.includes('#') || topic.includes('+')) {
      return done(null, sub);
    }

    // Enforce ownership for direct /devices/{mac}/... subscriptions.
    if (this.isDevicesTopic(topic)) {
      if (client?.isEsp) {
        const clientMac = client?.deviceMac;
        if (
          clientMac &&
          this.isAuthorizedDevicesSubscriptionFilter(clientMac, topic)
        ) {
          return done(null, sub);
        }
      }

      if (
        client?.isUserClient &&
        this.isUserAuthorizedForDevicesTopic(client, topic)
      ) {
        return done(null, sub);
      }

      this.logger.warn(
        `MQTT subscribe rejected. clientId=${client?.id ?? 'unknown'} topic=${topic}`
      );
      return done(null, null);
    }

    if (this.isEspTopic(topic)) {
      if (client?.isEsp) {
        const clientMac = client?.deviceMac;
        if (
          clientMac &&
          this.isAuthorizedEspSubscriptionFilter(clientMac, topic)
        ) {
          return done(null, sub);
        }
      }

      if (
        client?.isUserClient &&
        this.isUserAuthorizedForEspTopic(client, topic)
      ) {
        return done(null, sub);
      }

      this.logger.warn(
        `MQTT subscribe rejected. clientId=${client?.id ?? 'unknown'} topic=${topic}`
      );
      return done(null, null);
    }

    return done(null, sub);
  }

  private onAuthorizeForward(
    client: MqttClientContext,
    packet: { topic?: string }
  ) {
    const topic = packet?.topic ?? '';

    if (this.isDevicesTopic(topic)) {
      if (client?.isEsp) {
        const clientMac = client?.deviceMac;
        if (clientMac && this.isAuthorizedForDevicesTopic(clientMac, topic)) {
          return packet;
        }
      }

      if (
        client?.isUserClient &&
        this.isUserAuthorizedForDevicesTopic(client, topic)
      ) {
        return packet;
      }

      this.logger.warn(
        `MQTT forward blocked. clientId=${client?.id ?? 'unknown'} topic=${topic}`
      );
      return null;
    }

    if (this.isEspTopic(topic)) {
      if (client?.isEsp) {
        const clientMac = client?.deviceMac;
        if (clientMac && this.isAuthorizedForEspTopic(clientMac, topic)) {
          return packet;
        }
      }

      if (
        client?.isUserClient &&
        this.isUserAuthorizedForEspTopic(client, topic)
      ) {
        return packet;
      }

      this.logger.warn(
        `MQTT forward blocked. clientId=${client?.id ?? 'unknown'} topic=${topic}`
      );
      return null;
    }

    return packet;
  }
  private async onClientDisconnect(client: MqttClientContext) {
    const clientId = client?.id?.toString?.() ?? '';
    if (clientId && client?.isEsp) {
      const normalizedMac = this.normalizeMacAddress(
        client.deviceMac ?? clientId
      );
      if (this.activeEspSessions.get(normalizedMac) === clientId) {
        this.activeEspSessions.delete(normalizedMac);
      }
      this.logicService.evictForDevice(normalizedMac);

      await this.mqttService.publish(`client/${clientId}/online`, {
        online: false,
        timestamp: new Date().toISOString(),
      });
      await this.devicesService.updateLastActiveByMacAddress(clientId);
    }
    this.logger.debug(`MQTT client disconnected. clientId=${clientId}`);
  }

  private isInputTopic(topic: string): boolean {
    return (
      INPUT_TOPIC_PATTERN.test(topic) || LEGACY_INPUT_TOPIC_PATTERN.test(topic)
    );
  }

  private getInputNodeIdFromTopic(topic: string): string | null {
    const prefixedMatch = topic.match(INPUT_TOPIC_PATTERN);
    if (prefixedMatch) {
      return prefixedMatch[1] || null;
    }

    const legacyMatch = topic.match(LEGACY_INPUT_TOPIC_PATTERN);
    if (!legacyMatch) return null;
    return legacyMatch[1] || null;
  }

  private clampToByte(value: number): number {
    return Math.min(255, Math.max(0, Math.round(value)));
  }

  private mapAnalogToByte(value: number): number {
    const normalized = Math.min(4095, Math.max(0, value));
    return Math.round((normalized * 255) / 4095);
  }

  private mapPercentToByte(value: number): number {
    const normalized = Math.min(100, Math.max(0, value));
    return Math.round((normalized * 255) / 100);
  }

  private buildFunctionErrorTopic(deviceMac: string, nodeId: string): string {
    return `/devices/${this.normalizeMacAddress(deviceMac)}/logic/error/${nodeId}`;
  }

  private buildFunctionDebugTopic(deviceMac: string, nodeId: string): string {
    return `/devices/${this.normalizeMacAddress(deviceMac)}/logic/debug/${nodeId}`;
  }

  private extractNumericInputValue(packet: MqttPacketContext): number | null {
    const payload = packet?.payload;
    if (!Buffer.isBuffer(payload)) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(payload.toString('utf8'));
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }

      const input = parsed as InputPayload;

      // GPIO analog read already returns result in 0..255.
      if (typeof input.result === 'number') {
        return this.clampToByte(input.result);
      }
      if (typeof input.value === 'number') return this.clampToByte(input.value);

      // Sensor tasks publish raw digital/motion values as 0/1 or booleans.
      if (typeof input.digital === 'number') return input.digital ? 1 : 0;
      if (typeof input.motion === 'number') return input.motion ? 1 : 0;
      if (typeof input.result === 'boolean') return input.result ? 1 : 0;
      if (typeof input.motion === 'boolean') return input.motion ? 1 : 0;
      if (typeof input.digital === 'boolean') return input.digital ? 1 : 0;

      // Raw analog sensor/task payloads are normalized to byte range for GPIO logic.
      if (typeof input.analog === 'number') {
        return this.mapAnalogToByte(input.analog);
      }
      if (typeof input.raw === 'number') return this.mapAnalogToByte(input.raw);
      if (typeof input.percent === 'number') {
        return this.mapPercentToByte(input.percent);
      }

      // DHT task payloads publish temperature/humidity directly.
      if (typeof input.temperature === 'number') {
        return this.clampToByte(input.temperature);
      }
      if (typeof input.humidity === 'number') {
        return this.clampToByte(input.humidity);
      }

      if (typeof input.distance_cm === 'number') {
        return this.clampToByte(input.distance_cm);
      }

      return null;
    } catch {
      return null;
    }
  }

  private extractRawInputPayload(
    packet: MqttPacketContext
  ): InputPayload | null {
    const payload = packet?.payload;
    if (!Buffer.isBuffer(payload)) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(payload.toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }

      return parsed as InputPayload;
    } catch {
      return null;
    }
  }

  private extractAlertSensorType(
    rawPayload: InputPayload | null,
    inputNodeId: string
  ): string {
    if (
      typeof rawPayload?.sensorType === 'string' &&
      rawPayload.sensorType.trim()
    ) {
      return rawPayload.sensorType.trim();
    }

    if (typeof rawPayload?.type === 'string' && rawPayload.type.trim()) {
      return rawPayload.type.trim();
    }

    return inputNodeId;
  }

  private extractAlertNumericValue(
    rawPayload: InputPayload | null,
    normalizedInput: number | null
  ): number | null {
    if (!rawPayload) {
      return normalizedInput;
    }

    if (
      typeof rawPayload.value === 'number' &&
      Number.isFinite(rawPayload.value)
    ) {
      return rawPayload.value;
    }
    if (
      typeof rawPayload.result === 'number' &&
      Number.isFinite(rawPayload.result)
    ) {
      return rawPayload.result;
    }
    if (typeof rawPayload.raw === 'number' && Number.isFinite(rawPayload.raw)) {
      return rawPayload.raw;
    }
    if (
      typeof rawPayload.analog === 'number' &&
      Number.isFinite(rawPayload.analog)
    ) {
      return rawPayload.analog;
    }
    if (
      typeof rawPayload.percent === 'number' &&
      Number.isFinite(rawPayload.percent)
    ) {
      return rawPayload.percent;
    }
    if (
      typeof rawPayload.temperature === 'number' &&
      Number.isFinite(rawPayload.temperature)
    ) {
      return rawPayload.temperature;
    }
    if (
      typeof rawPayload.humidity === 'number' &&
      Number.isFinite(rawPayload.humidity)
    ) {
      return rawPayload.humidity;
    }
    if (
      typeof rawPayload.distance_cm === 'number' &&
      Number.isFinite(rawPayload.distance_cm)
    ) {
      return rawPayload.distance_cm;
    }
    if (
      typeof rawPayload.digital === 'number' &&
      Number.isFinite(rawPayload.digital)
    ) {
      return rawPayload.digital ? 1 : 0;
    }
    if (
      typeof rawPayload.motion === 'number' &&
      Number.isFinite(rawPayload.motion)
    ) {
      return rawPayload.motion ? 1 : 0;
    }
    if (typeof rawPayload.digital === 'boolean') {
      return rawPayload.digital ? 1 : 0;
    }
    if (typeof rawPayload.motion === 'boolean') {
      return rawPayload.motion ? 1 : 0;
    }
    if (typeof rawPayload.result === 'boolean') {
      return rawPayload.result ? 1 : 0;
    }

    return normalizedInput;
  }

  private async evaluateAlertRulesForInput(params: {
    flowId: string;
    inputNodeId: string;
    topic: string;
    rawPayload: InputPayload | null;
    normalizedInput: number | null;
    deviceMac: string;
    clientId: string;
  }): Promise<void> {
    const sensorType = this.extractAlertSensorType(
      params.rawPayload,
      params.inputNodeId
    );
    const readingValue = this.extractAlertNumericValue(
      params.rawPayload,
      params.normalizedInput
    );

    if (readingValue === null || !Number.isFinite(readingValue)) {
      return;
    }

    const outcome = await this.notificationsService.processSensorReading({
      // Current runtime has no separate project entity; we scope alerts by active flow id.
      projectId: params.flowId,
      sensorType,
      value: readingValue,
      metadata: {
        topic: params.topic,
        inputNodeId: params.inputNodeId,
        deviceMac: params.deviceMac,
        clientId: params.clientId,
      },
    });

    if (outcome.triggeredRules > 0) {
      this.logger.log(
        `Triggered ${outcome.triggeredRules} alert rule(s) for flowId=${params.flowId} sensorType=${sensorType} value=${readingValue}`
      );
    }
  }

  private isGpioRuntimeCommand(command: RuntimeCommand): boolean {
    return (
      command.stepType === 'output' &&
      (command.targetModuleType === 'digital' ||
        command.targetModuleType === 'pwm' ||
        command.targetModuleType === 'dac' ||
        command.targetModuleType === 'servo')
    );
  }

  private createRuntimeMessage(params: {
    inputNodeId: string;
    inputModuleId: string;
    payload: unknown;
    normalizedInput: number | null;
    topic: string;
    flowId: string;
    deviceMac: string;
  }): RuntimeMessage {
    const timestamp = new Date().toISOString();

    return {
      payload: params.payload,
      value: params.payload,
      topic: params.topic,
      nodeId: params.inputNodeId,
      moduleId: params.inputModuleId,
      flowId: params.flowId,
      device: {
        macAddress: params.deviceMac,
      },
      input: {
        payload: params.payload,
        normalized: params.normalizedInput,
        topic: params.topic,
      },
      metadata: {
        timestamp,
      },
    };
  }

  private byteToAnalogRaw(value: number): number {
    const clamped = this.clampToByte(value);
    return Math.round((clamped * 4095) / 255);
  }

  private buildFunctionInitialPayload(
    rawPayload: InputPayload | null,
    normalizedInput: number | null
  ): unknown {
    if (rawPayload && typeof rawPayload === 'object') {
      const normalizedPayload: InputPayload = { ...rawPayload };

      if (
        normalizedInput !== null &&
        typeof normalizedPayload.result !== 'number'
      ) {
        normalizedPayload.result = normalizedInput;
      }

      if (typeof normalizedPayload.raw !== 'number') {
        if (typeof normalizedPayload.analog === 'number') {
          normalizedPayload.raw = normalizedPayload.analog;
        } else if (normalizedInput !== null) {
          normalizedPayload.raw = this.byteToAnalogRaw(normalizedInput);
        }
      }

      return normalizedPayload;
    }

    if (normalizedInput !== null) {
      return {
        result: normalizedInput,
        raw: this.byteToAnalogRaw(normalizedInput),
      } as InputPayload;
    }

    return rawPayload;
  }

  private pathUsesFunctionSteps(flow: unknown[]): boolean {
    return flow.some(
      (step) =>
        typeof step === 'object' &&
        step !== null &&
        'stepType' in step &&
        (step as RuntimeCommand).stepType === 'function'
    );
  }

  private cloneMessageForSandbox(message: RuntimeMessage): RuntimeMessage {
    try {
      return structuredClone(message);
    } catch {
      return JSON.parse(JSON.stringify(message)) as RuntimeMessage;
    }
  }

  private isPayloadSizeAllowed(payload: unknown): boolean {
    if (payload === null || payload === undefined) return true;

    if (typeof payload === 'number' || typeof payload === 'boolean') {
      return true;
    }

    if (typeof payload === 'string') {
      return (
        Buffer.byteLength(payload, 'utf8') <= this.functionNodeMaxPayloadBytes
      );
    }

    try {
      const serialized = JSON.stringify(payload);
      if (serialized === undefined) return false;
      return (
        Buffer.byteLength(serialized, 'utf8') <=
        this.functionNodeMaxPayloadBytes
      );
    } catch {
      return false;
    }
  }

  private executeFunctionCodeInSandbox(
    code: string,
    message: RuntimeMessage
  ): unknown {
    const script = `'use strict'; (function(msg) { ${code}\n})(msg);`;
    const sandbox = {
      msg: message,
      Number,
      Math,
      parseInt,
      parseFloat,
      isNaN,
      Boolean,
      String,
      Date,
      JSON,
      mapValue: (
        value: number,
        inMin: number,
        inMax: number,
        outMin: number,
        outMax: number
      ) => this.mapValue(value, inMin, inMax, outMin, outMax),
    };

    return vm.runInNewContext(script, sandbox, {
      timeout: this.functionExecutionTimeoutMs,
      displayErrors: true,
      contextCodeGeneration: {
        strings: false,
        wasm: false,
      },
      microtaskMode: 'afterEvaluate',
    });
  }

  /* eslint-disable @typescript-eslint/no-unsafe-assignment */
  private normalizeFunctionResult(
    result: unknown,
    currentMessage: RuntimeMessage
  ): RuntimeMessage | null {
    if (result === null || result === undefined) {
      return null;
    }

    if (typeof result !== 'object' || Array.isArray(result)) {
      if (!this.isPayloadSizeAllowed(result)) {
        throw new Error('Function result payload exceeds allowed size');
      }

      return {
        ...currentMessage,
        payload: result,
        value: result,
      };
    }

    // result comes from untyped sandbox execution; suppress narrow assignment lint here

    const candidate = result as Partial<RuntimeMessage> & { payload?: unknown };
    const hasPayload = Object.prototype.hasOwnProperty.call(
      candidate,
      'payload'
    );
    const hasValue = Object.prototype.hasOwnProperty.call(candidate, 'value');

    // candidate may originate from untyped runtime results — narrow with explicit casts

    const candidatePayload: unknown = candidate.payload;

    const currentPayload: unknown = currentMessage.payload;
    const payload: unknown = hasPayload ? candidatePayload : currentPayload;
    if (!this.isPayloadSizeAllowed(payload)) {
      throw new Error('Function result payload exceeds allowed size');
    }

    const candidateValue: unknown = candidate.value;

    const currentValue: unknown = currentMessage.value;
    const nextValue: unknown = hasPayload
      ? candidatePayload
      : hasValue
        ? candidateValue
        : currentValue;

    return {
      ...currentMessage,
      payload,
      value: nextValue,
    };
  }
  /* eslint-enable @typescript-eslint/no-unsafe-assignment */

  private executeFunctionStep(
    step: RuntimeCommand,
    currentMessage: RuntimeMessage
  ): RuntimeMessage | null {
    const code = String(step.code ?? '').trim() || 'return msg;';
    const validationError =
      this.logicService.validateFunctionCodeAtRuntime(code);
    if (validationError) {
      throw new Error(`Invalid function code: ${validationError}`);
    }

    const msg: RuntimeMessage = {
      ...currentMessage,
      nodeId: String(step.id ?? currentMessage.nodeId),
      moduleId: String(step.moduleId ?? currentMessage.moduleId),
      device: { ...currentMessage.device },
      input: { ...currentMessage.input },
      metadata: { ...currentMessage.metadata },
    };

    const sandboxMessage = this.cloneMessageForSandbox(msg);
    const result = this.executeFunctionCodeInSandbox(code, sandboxMessage);

    return this.normalizeFunctionResult(result, msg);
  }

  private coerceRuntimeOutputValue(message: RuntimeMessage): number | null {
    const payload = message.payload;
    if (typeof payload === 'number' && Number.isFinite(payload)) {
      return this.clampToByte(payload);
    }
    if (typeof payload === 'boolean') {
      return payload ? 1 : 0;
    }
    if (typeof payload === 'string') {
      const parsed = Number(payload);
      if (Number.isFinite(parsed)) {
        return this.clampToByte(parsed);
      }
    }
    return null;
  }

  private mapValue(
    value: number,
    inMin: number,
    inMax: number,
    outMin: number,
    outMax: number
  ): number {
    if (!Number.isFinite(value)) return outMin;
    if (!Number.isFinite(inMin) || !Number.isFinite(inMax)) return outMin;
    if (!Number.isFinite(outMin) || !Number.isFinite(outMax)) return outMin;
    if (inMax === inMin) return outMin;

    return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
  }

  private coerceServoOutputValue(
    message: RuntimeMessage,
    usesFunctionSteps: boolean
  ): number | null {
    const payload = message.payload;
    let numericValue: number | null = null;

    if (typeof payload === 'number' && Number.isFinite(payload)) {
      numericValue = payload;
    } else if (typeof payload === 'boolean') {
      numericValue = payload ? 180 : 0;
    } else if (typeof payload === 'string') {
      const parsed = Number(payload);
      if (Number.isFinite(parsed)) {
        numericValue = parsed;
      }
    }

    if (numericValue === null) {
      return null;
    }

    const angle = usesFunctionSteps
      ? numericValue
      : this.mapValue(numericValue, 0, 255, 0, 180);

    return Math.round(Math.min(180, Math.max(0, angle)));
  }

  private async executeGpioLogicForInputTopic(
    topic: string,
    packet: MqttPacketContext,
    client: MqttClientContext
  ): Promise<void> {
    Logger.debug(
      `Processing MQTT publish for GPIO logic. topic=${topic} clientId=${client?.id ?? 'unknown'}`
    );

    const inputNodeId = this.getInputNodeIdFromTopic(topic);
    if (!inputNodeId) {
      this.logger.debug(
        `Skip GPIO logic: failed to extract node id from topic ${topic}`
      );
      return;
    }

    const inputValue = this.extractNumericInputValue(packet);
    const rawPayload = this.extractRawInputPayload(packet);
    if (inputValue === null && rawPayload === null) {
      this.logger.debug(
        `Skip GPIO logic: could not extract usable payload for topic ${topic}`
      );
      return;
    }

    const deviceMac =
      typeof client?.deviceMac === 'string' ? client.deviceMac : null;
    if (!deviceMac) {
      this.logger.debug('Skip GPIO logic: missing client.deviceMac');
      return;
    }

    const flowId = client.linkedFlowId;
    this.logger.debug(
      `Received MQTT input. topic=${topic} nodeId=${inputNodeId} value=${inputValue ?? 'n/a'} deviceMac=${deviceMac} flowId=${flowId ?? 'none'}`
    );
    if (!flowId) {
      this.logger.debug(
        `Skip GPIO logic: no linked flow for device ${deviceMac}`
      );
      return;
    }

    try {
      await this.evaluateAlertRulesForInput({
        flowId,
        inputNodeId,
        topic,
        rawPayload,
        normalizedInput: inputValue,
        deviceMac: this.normalizeMacAddress(deviceMac),
        clientId: client?.id?.toString?.() ?? 'unknown',
      });
    } catch (error) {
      this.logger.error(
        `Failed to evaluate alert rules for topic=${topic}: ${(error as Error).message}`
      );
    }

    const flows = await this.logicService.getLogicFlowsForFlowId(
      flowId,
      deviceMac
    );

    if (!flows.length) {
      this.logger.debug(
        `Skip GPIO logic: no flows in logic program for flowId=${flowId}`
      );
      return;
    }

    const commandTopic = `esp/${this.normalizeMacAddress(deviceMac)}/cmd`;
    this.logger.debug(
      `Logic loaded. flowId=${flowId} totalFlowPaths=${flows.length} commandTopic=${commandTopic}`
    );

    let matchedSteps = 0;
    let publishedCommands = 0;

    for (const flow of flows) {
      if (!Array.isArray(flow) || !flow.length) {
        continue;
      }
      if (flow.length > MAX_RUNTIME_STEPS_PER_PATH) {
        this.logger.warn(
          `Skipping runtime path due to excessive length (${flow.length} steps).`
        );
        continue;
      }

      const functionStepsInPath = flow.reduce<number>((count, step) => {
        const runtimeStep = step as RuntimeCommand;
        return runtimeStep?.stepType === 'function' ? count + 1 : count;
      }, 0);
      if (functionStepsInPath > MAX_RUNTIME_FUNCTION_STEPS_PER_PATH) {
        this.logger.warn(
          `Skipping runtime path due to excessive function node depth (${functionStepsInPath}).`
        );
        continue;
      }

      const firstStep = flow[0] as RuntimeCommand | undefined;
      if (firstStep?.id !== inputNodeId) {
        continue;
      }

      matchedSteps++;
      this.logger.debug(
        `Matched runtime path for nodeId=${inputNodeId} with ${flow.length} steps`
      );

      const usesFunctionSteps = this.pathUsesFunctionSteps(flow);
      const initialPayload = usesFunctionSteps
        ? this.buildFunctionInitialPayload(rawPayload, inputValue)
        : inputValue;

      let currentMessage = this.createRuntimeMessage({
        inputNodeId,
        inputModuleId: String(firstStep.moduleId ?? ''),
        payload: initialPayload,
        normalizedInput: inputValue,
        topic,
        flowId,
        deviceMac: this.normalizeMacAddress(deviceMac),
      });
      let pathStopped = false;

      for (const rawStep of flow.slice(1)) {
        const step = rawStep as RuntimeCommand;

        if (step.stepType === 'function') {
          const functionNodeId = String(step.id ?? 'unknown');
          try {
            const nextMessage = this.executeFunctionStep(step, currentMessage);
            if (nextMessage === null) {
              await this.mqttService.publish(
                this.buildFunctionDebugTopic(deviceMac, functionNodeId),
                {
                  code: 'FUNCTION_RETURNED_NULL',
                  severity: 'info',
                  message:
                    'Function node returned null/undefined, so this runtime path was stopped.',
                  flowId,
                  nodeId: functionNodeId,
                  moduleId: step.moduleId,
                  inputTopic: topic,
                  timestamp: new Date().toISOString(),
                }
              );
              pathStopped = true;
              break;
            }
            currentMessage = nextMessage;
          } catch (error) {
            this.logger.warn(
              `Function node ${step.id ?? 'unknown'} failed: ${(error as Error).message}`
            );

            const functionNodeId = String(step.id ?? 'unknown');
            await this.mqttService.publish(
              this.buildFunctionErrorTopic(deviceMac, functionNodeId),
              {
                code: 'FUNCTION_EXECUTION_FAILED',
                message: (error as Error).message,
                flowId,
                nodeId: functionNodeId,
                moduleId: step.moduleId,
                inputTopic: topic,
                timestamp: new Date().toISOString(),
              }
            );

            await this.mqttService.publish(
              this.buildFunctionDebugTopic(deviceMac, functionNodeId),
              {
                code: 'FUNCTION_EXECUTION_FAILED',
                severity: 'error',
                message: (error as Error).message,
                flowId,
                nodeId: functionNodeId,
                moduleId: step.moduleId,
                inputTopic: topic,
                timestamp: new Date().toISOString(),
              }
            );
            pathStopped = true;
            break;
          }
          continue;
        }

        if (!this.isGpioRuntimeCommand(step)) {
          continue;
        }

        if (typeof step.cmd !== 'number' || typeof step.pin !== 'number') {
          continue;
        }

        const outputValue =
          step.targetModuleType === 'servo'
            ? this.coerceServoOutputValue(currentMessage, usesFunctionSteps)
            : this.coerceRuntimeOutputValue(currentMessage);
        if (outputValue === null) {
          this.logger.warn(
            `Output step ${step.id ?? 'unknown'} skipped because payload is not a numeric, boolean, or numeric string value.`
          );
          continue;
        }

        await this.mqttService.publish(commandTopic, {
          command: {
            cmd: step.cmd,
            pin: step.pin,
            value: outputValue,
            topic: step.topic,
          },
        });
        publishedCommands++;

        this.logger.debug(
          `Published GPIO logic command. cmd=${step.cmd} pin=${step.pin} value=${outputValue} topic=${commandTopic}`
        );
      }

      if (pathStopped) {
        continue;
      }
    }

    if (matchedSteps === 0) {
      this.logger.debug(
        `No matching logic step for input nodeId=${inputNodeId} in flowId=${flowId}`
      );
    }

    this.logger.debug(
      `GPIO logic processing finished. nodeId=${inputNodeId} matchedSteps=${matchedSteps} publishedCommands=${publishedCommands}`
    );
  }

  private async onClientPublish(
    packet: MqttPacketContext,
    client: MqttClientContext
  ) {
    const topic = packet?.topic ?? '';
    const clientId = client?.id?.toString?.() ?? '';

    if (topic) {
      if (clientId) {
        this.logger.debug(
          `MQTT message published. clientId=${clientId || 'broker'} topic=${topic}`
        );
      }

      // Broker-originated publishes may not include a client id.
      // Handle flow update/change topics regardless of publisher to keep cache coherent.
      if (topic.includes('/flowupdated') || topic.includes('/flowchanged')) {
        const topicMac = this.extractDevicesTopicMac(topic);
        if (topicMac) {
          this.logger.log(
            `Flow update detected for device ${topicMac}, evicting logic cache.`
          );
          this.logicService.evictForDevice(topicMac);
        }
      }

      if (clientId && client?.isEsp && this.isInputTopic(topic)) {
        try {
          await this.executeGpioLogicForInputTopic(topic, packet, client);
        } catch (error) {
          this.logger.error(
            `Failed to execute server-side GPIO logic for topic=${topic}: ${(error as Error).message}`
          );
        }
      }
    }
  }
}
