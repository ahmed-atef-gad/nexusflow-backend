import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PigeonService } from '../pigeon-mqtt/pigeon.service';
import { DevicesService } from '../devices/devices.service';
import { UsersService } from '../users/users.service';
import { MqttService } from './mqtt.service';
import { InjectModel } from '@nestjs/mongoose';
import { Logic, LogicDocument } from '../flows/schemas/logic.schema';
import { Model } from 'mongoose';

type OutputModuleType = 'pwm' | 'digital' | 'dac' | 'other';

type RuntimeCommand = {
  targetModuleType?: OutputModuleType;
  cmd: number;
  pin?: number;
  value?: number | string;
  topic?: string;
};

type MqttClientAttributes = {
  esp?: boolean;
  clientType?: 'esp' | 'user';
  macAddress?: string;
  username?: string;
};

type MqttClientContext = {
  id?: string;
  deviceMac?: string;
  linkedFlowId?: string | null;
  isEsp?: boolean;
  isUserClient?: boolean;
  authorizedDeviceMacs?: string[];
  userId?: string;
  mqttUsername?: string;
  attributes?: MqttClientAttributes;
};

type MqttPacketContext = {
  topic?: string;
  payload?: Buffer;
};

type InputPayload = {
  result?: number | boolean;
  value?: number;
  digital?: number | boolean;
  analog?: number;
  motion?: number | boolean;
  raw?: number;
  percent?: number;
  temperature?: number;
  humidity?: number;
};

const INPUT_TOPIC_PATTERN = /^logic\/input\/([^/]+)$/;
const LEGACY_INPUT_TOPIC_PATTERN = /^esp\/([^/]+)$/;

@Injectable()
export class MqttHandlers implements OnModuleInit {
  private readonly logger = new Logger(MqttHandlers.name);

  constructor(
    private readonly pigeonService: PigeonService,
    private readonly devicesService: DevicesService,
    private readonly usersService: UsersService,
    private readonly mqttService: MqttService,
    @InjectModel(Logic.name)
    private readonly logicModel: Model<LogicDocument>
  ) {}

  onModuleInit() {
    const broker = this.pigeonService.getBrokerInstance();
    broker.authenticate = this.onAuthenticate.bind(this);
    broker.authorizePublish = this.onAuthorizePublish.bind(this);
    broker.authorizeSubscribe = this.onAuthorizeSubscribe.bind(this);
    broker.authorizeForward = this.onAuthorizeForward.bind(this);
    broker.on('clientDisconnect', this.onClientDisconnect.bind(this));
    broker.on('publish', this.onClientPublish.bind(this));
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
  private extractDevicesTopicMac(topic: string): string | null {
    const segments = topic.split('/').filter(Boolean);
    if (segments.length < 2 || segments[0] !== 'devices') return null;
    if (segments[1] === '+' || segments[1] === '#') return null;
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

        client.deviceMac = normalizedClientMac;
        client.linkedFlowId = device.activeFlowId?.toString() ?? null;
        client.isEsp = true;
        client.isUserClient = false;
        client.attributes = {
          ...(client.attributes ?? {}),
          esp: true,
          clientType: 'esp',
          macAddress: normalizedClientMac,
        };

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

      const userDevices = await this.devicesService.findAllByUserId(userId);
      client.authorizedDeviceMacs = userDevices.map((device) =>
        this.normalizeMacAddress(device.macAddress)
      );
      client.isEsp = false;
      client.isUserClient = true;
      client.userId = userId;
      client.mqttUsername = user.username;
      client.attributes = {
        ...(client.attributes ?? {}),
        esp: false,
        clientType: 'user',
        username: user.username,
      };

      this.logger.log(
        `MQTT auth accepted. clientId=${clientId} type=user username=${user.username}`
      );
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

    if (!this.isDevicesTopic(topic)) {
      return done(null);
    }

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

  private onAuthorizeSubscribe(
    client: MqttClientContext,
    sub: { topic: string; qos?: 0 | 1 | 2 },
    done: (
      error: Error | null,
      granted?: { topic: string; qos?: 0 | 1 | 2 } | null
    ) => void
  ) {
    const topic = sub?.topic ?? '';

    // For /devices/* topics: allow wildcard subscriptions for ESP only.
    if (
      this.isDevicesTopic(topic) &&
      (topic.includes('#') || topic.includes('+'))
    ) {
      if (client?.isEsp) {
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

    return done(null, sub);
  }

  private onAuthorizeForward(
    client: MqttClientContext,
    packet: { topic?: string }
  ) {
    const topic = packet?.topic ?? '';
    if (!this.isDevicesTopic(topic)) return packet;

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
  private async onClientDisconnect(client: MqttClientContext) {
    const clientId = client?.id?.toString?.() ?? '';
    if (clientId && client?.isEsp) {
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

      return null;
    } catch {
      return null;
    }
  }

  private isGpioRuntimeCommand(command: RuntimeCommand): boolean {
    return (
      command.targetModuleType === 'digital' ||
      command.targetModuleType === 'pwm' ||
      command.targetModuleType === 'dac'
    );
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
    if (inputValue === null) {
      this.logger.debug(
        `Skip GPIO logic: could not extract numeric value from payload for topic ${topic}`
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
      `Received MQTT input. topic=${topic} nodeId=${inputNodeId} value=${inputValue} deviceMac=${deviceMac} flowId=${flowId ?? 'none'}`
    );
    if (!flowId) {
      this.logger.debug(
        `Skip GPIO logic: no linked flow for device ${deviceMac}`
      );
      return;
    }

    const logicDoc = await this.logicModel
      .findOne({ flowId })
      .select('program')
      .lean()
      .exec();

    const flows = Array.isArray((logicDoc as any)?.program?.flows)
      ? (logicDoc as any).program.flows
      : [];

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
      if (!Array.isArray(flow)) {
        continue;
      }

      for (const step of flow) {
        if (step?.id !== inputNodeId) {
          continue;
        }

        matchedSteps++;

        const commands = Array.isArray(step?.commands)
          ? (step.commands as RuntimeCommand[])
          : [];

        this.logger.debug(
          `Matched step for nodeId=${inputNodeId} with ${commands.length} commands`
        );

        for (const command of commands) {
          if (!this.isGpioRuntimeCommand(command)) {
            continue;
          }

          if (
            typeof command.cmd !== 'number' ||
            typeof command.pin !== 'number'
          ) {
            continue;
          }

          await this.mqttService.publish(commandTopic, {
            command: {
              cmd: command.cmd,
              pin: command.pin,
              value: inputValue,
              topic: command.topic,
            },
          });
          publishedCommands++;

          this.logger.debug(
            `Published GPIO logic command. cmd=${command.cmd} pin=${command.pin} value=${inputValue} topic=${commandTopic}`
          );
        }
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

    if (topic && clientId) {
      this.logger.debug(
        `MQTT message published. clientId=${clientId} topic=${topic}`
      );

      if (client?.isEsp && this.isInputTopic(topic)) {
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
