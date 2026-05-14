import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  MqttPerformanceSessionRecord,
  MqttPerformanceSessionDocument,
} from './schemas/mqtt-performance-session.schema';

type TimingStats = {
  count: number;
  avgMs: number | null;
  minMs: number | null;
  maxMs: number | null;
  p95Ms: number | null;
  lastMs: number | null;
};

type MutableTimingStats = TimingStats & {
  totalMs: number;
  samples: number[];
};

export type MqttLogicPathSample = {
  flowId: string;
  inputNodeId: string;
  pathIndex: number;
  steps: number;
  durationMs: number;
  publishedCommands: number;
  stopped: boolean;
  finishedAt: string;
};

export type MqttMessageSample = {
  topic: string;
  receivedAt: string;
  publishedAt: string | null;
  latencyMs: number | null;
};

export type MqttPerformanceSession = {
  sessionId: string;
  clientId: string;
  deviceMac: string;
  deviceId: string | null;
  deviceName: string | null;
  ownerId: string | null;
  ownerUsername: string | null;
  flowId: string | null;
  connectedAt: string;
  disconnectedAt: string | null;
  active: boolean;
  clockSkewMs: number;
  messages: {
    received: number;
    withPublishedAt: number;
    lastTopic: string | null;
    lastReceivedAt: string | null;
    latency: TimingStats;
    recentMessages: MqttMessageSample[];
  };
  logic: {
    pipelineRuns: number;
    matchedPaths: number;
    publishedCommands: number;
    pipelineDuration: TimingStats;
    pathDuration: TimingStats;
    recentPaths: MqttLogicPathSample[];
  };
};

type MutableMqttPerformanceSession = Omit<
  MqttPerformanceSession,
  'messages' | 'logic'
> & {
  messages: Omit<MqttPerformanceSession['messages'], 'latency'> & {
    latency: MutableTimingStats;
  };
  logic: Omit<
    MqttPerformanceSession['logic'],
    'pipelineDuration' | 'pathDuration'
  > & {
    pipelineDuration: MutableTimingStats;
    pathDuration: MutableTimingStats;
  };
};

const MAX_TIMING_SAMPLES = 200;
const MAX_RECENT_MESSAGES = 50;
const MAX_RECENT_PATHS = 50;
const MAX_CLOSED_SESSIONS = 100;

@Injectable()
export class MqttPerformanceService {
  private readonly logger = new Logger(MqttPerformanceService.name);
  private readonly activeSessionsByMac = new Map<
    string,
    MutableMqttPerformanceSession
  >();
  private readonly closedSessions: MutableMqttPerformanceSession[] = [];

  constructor(
    @InjectModel(MqttPerformanceSessionRecord.name)
    private readonly performanceSessionModel: Model<MqttPerformanceSessionDocument>
  ) {}

  async startEspSession(params: {
    clientId: string;
    deviceMac: string;
    deviceId?: string | null;
    deviceName?: string | null;
    ownerId?: string | null;
    ownerUsername?: string | null;
    flowId?: string | null;
  }): Promise<string> {
    const now = new Date();
    const normalizedMac = params.deviceMac.trim().toUpperCase();
    const sessionId = `${normalizedMac}:${now.getTime()}`;

    const existing = this.activeSessionsByMac.get(normalizedMac);
    if (existing) {
      await this.closeSession(existing, now);
    }

    const session: MutableMqttPerformanceSession = {
      sessionId,
      clientId: params.clientId,
      deviceMac: normalizedMac,
      deviceId: params.deviceId ?? null,
      deviceName: params.deviceName ?? null,
      ownerId: params.ownerId ?? null,
      ownerUsername: params.ownerUsername ?? null,
      flowId: params.flowId ?? null,
      connectedAt: now.toISOString(),
      disconnectedAt: null,
      active: true,
      clockSkewMs: 0,
      messages: {
        received: 0,
        withPublishedAt: 0,
        lastTopic: null,
        lastReceivedAt: null,
        latency: this.createTimingStats(),
        recentMessages: [],
      },
      logic: {
        pipelineRuns: 0,
        matchedPaths: 0,
        publishedCommands: 0,
        pipelineDuration: this.createTimingStats(),
        pathDuration: this.createTimingStats(),
        recentPaths: [],
      },
    };

    this.activeSessionsByMac.set(normalizedMac, session);
    return sessionId;
  }

  calibrateClockSkew(params: {
    deviceMac: string;
    clientId: string;
    deviceTimeMs: number;
    receivedAtMs: number;
  }): void {
    const session = this.getActiveSession(params.deviceMac, params.clientId);
    if (!session) return;

    // Skew = DeviceTime - ServerTime (if positive, device is ahead; if negative, server is ahead)
    // We want correctedLatency = (ServerTime - DeviceTime) + Skew
    // Actually, simpler: Skew = DeviceTime - (ServerTime - NetworkOneWayDelay)
    // Since we don't know the delay, we assume ~50ms.
    // Skew = deviceTimeMs - receivedAtMs
    const skew = params.deviceTimeMs - params.receivedAtMs;
    session.clockSkewMs = skew;
    this.logger.log(
      `Calibrated clock skew for ${params.deviceMac}: ${skew}ms (Device is ${skew > 0 ? 'ahead' : 'behind'})`
    );
  }

  async endEspSession(deviceMac: string, clientId: string): Promise<void> {
    const normalizedMac = deviceMac.trim().toUpperCase();
    const session = this.activeSessionsByMac.get(normalizedMac);
    if (!session || session.clientId !== clientId) return;
    await this.closeSession(session, new Date());
  }

  recordInboundMessage(params: {
    deviceMac: string;
    clientId: string;
    topic: string;
    receivedAtMs: number;
    publishedAtMs: number | null;
  }): void {
    const session = this.getActiveSession(params.deviceMac, params.clientId);
    if (!session) return;

    session.messages.received += 1;
    session.messages.lastTopic = params.topic;
    const receivedAt = new Date(params.receivedAtMs).toISOString();
    session.messages.lastReceivedAt = receivedAt;

    let latencyMs: number | null = null;
    if (params.publishedAtMs !== null) {
      // Correct for clock skew: (ServerTime - DeviceTime) - Skew
      // Wait, if Skew = DeviceTime - ServerTime
      // then Latency = (ServerReceived - DevicePublished) + Skew
      // No. Latency = ServerReceived - DevicePublished - (ServerTime_at_DevicePublish - DeviceTime_at_DevicePublish)
      // Skew = DeviceClock - ServerClock
      // Corrected = (ServerRecv - DevicePub) + Skew
      latencyMs =
        params.receivedAtMs - params.publishedAtMs + session.clockSkewMs;

      // Ensure we don't get negative latency due to jitter
      if (Number.isFinite(latencyMs)) {
        latencyMs = Math.max(0, latencyMs);
        session.messages.withPublishedAt += 1;
        this.addTimingSample(session.messages.latency, latencyMs);
      } else {
        latencyMs = null;
      }
    }

    session.messages.recentMessages.unshift({
      topic: params.topic,
      receivedAt,
      publishedAt:
        params.publishedAtMs === null
          ? null
          : new Date(params.publishedAtMs).toISOString(),
      latencyMs: latencyMs === null ? null : this.round(latencyMs),
    });
    session.messages.recentMessages = session.messages.recentMessages.slice(
      0,
      MAX_RECENT_MESSAGES
    );
  }

  recordLogicPipeline(params: {
    deviceMac: string;
    clientId: string;
    durationMs: number;
    matchedPaths: number;
    publishedCommands: number;
  }): void {
    const session = this.getActiveSession(params.deviceMac, params.clientId);
    if (!session) return;

    session.logic.pipelineRuns += 1;
    session.logic.matchedPaths += params.matchedPaths;
    session.logic.publishedCommands += params.publishedCommands;
    this.addTimingSample(session.logic.pipelineDuration, params.durationMs);
  }

  recordLogicPath(params: {
    deviceMac: string;
    clientId: string;
    flowId: string;
    inputNodeId: string;
    pathIndex: number;
    steps: number;
    durationMs: number;
    publishedCommands: number;
    stopped: boolean;
  }): void {
    const session = this.getActiveSession(params.deviceMac, params.clientId);
    if (!session) return;

    this.addTimingSample(session.logic.pathDuration, params.durationMs);
    session.logic.recentPaths.unshift({
      flowId: params.flowId,
      inputNodeId: params.inputNodeId,
      pathIndex: params.pathIndex,
      steps: params.steps,
      durationMs: this.round(params.durationMs),
      publishedCommands: params.publishedCommands,
      stopped: params.stopped,
      finishedAt: new Date().toISOString(),
    });
    session.logic.recentPaths = session.logic.recentPaths.slice(
      0,
      MAX_RECENT_PATHS
    );
  }

  getSnapshot(): {
    activeSessions: MqttPerformanceSession[];
    closedSessions: MqttPerformanceSession[];
  } {
    return {
      activeSessions: Array.from(this.activeSessionsByMac.values()).map(
        (session) => this.toSnapshot(session)
      ),
      closedSessions: this.closedSessions.map((session) =>
        this.toSnapshot(session)
      ),
    };
  }

  getSession(sessionId: string): MqttPerformanceSession | null {
    const activeSession = Array.from(this.activeSessionsByMac.values()).find(
      (session) => session.sessionId === sessionId
    );
    if (activeSession) return this.toSnapshot(activeSession);

    const closedSession = this.closedSessions.find(
      (session) => session.sessionId === sessionId
    );
    return closedSession ? this.toSnapshot(closedSession) : null;
  }

  async getStoredSessions(limit = 100): Promise<MqttPerformanceSession[]> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const records = await this.performanceSessionModel
      .find({})
      .sort({ disconnectedAt: -1, connectedAt: -1 })
      .limit(safeLimit)
      .lean()
      .exec();

    return records.map((record) => {
      const messages = record.messages as MqttPerformanceSession['messages'];
      const rawRecord = record as unknown as { clockSkewMs?: number };
      return {
        sessionId: record.sessionId,
        clientId: record.clientId,
        deviceMac: record.deviceMac,
        deviceId: record.deviceId ?? null,
        deviceName: record.deviceName ?? null,
        ownerId: record.ownerId ?? null,
        ownerUsername: record.ownerUsername ?? null,
        flowId: record.flowId ?? null,
        connectedAt: record.connectedAt.toISOString(),
        disconnectedAt: record.disconnectedAt
          ? record.disconnectedAt.toISOString()
          : null,
        active: record.active,
        clockSkewMs: rawRecord.clockSkewMs ?? 0,
        messages: {
          ...messages,
          recentMessages: messages.recentMessages ?? [],
        },
        logic: record.logic as MqttPerformanceSession['logic'],
      };
    });
  }

  private async closeSession(
    session: MutableMqttPerformanceSession,
    disconnectedAt: Date
  ): Promise<void> {
    session.active = false;
    session.disconnectedAt = disconnectedAt.toISOString();
    this.activeSessionsByMac.delete(session.deviceMac);
    this.closedSessions.unshift(session);
    this.closedSessions.splice(MAX_CLOSED_SESSIONS);
    await this.persistClosedSession(session);
  }

  private async persistClosedSession(
    session: MutableMqttPerformanceSession
  ): Promise<void> {
    const snapshot = this.toSnapshot(session);

    try {
      await this.performanceSessionModel
        .updateOne(
          { sessionId: snapshot.sessionId },
          {
            $set: {
              sessionId: snapshot.sessionId,
              clientId: snapshot.clientId,
              deviceMac: snapshot.deviceMac,
              deviceId: snapshot.deviceId,
              deviceName: snapshot.deviceName,
              ownerId: snapshot.ownerId,
              ownerUsername: snapshot.ownerUsername,
              flowId: snapshot.flowId,
              connectedAt: new Date(snapshot.connectedAt),
              disconnectedAt: snapshot.disconnectedAt
                ? new Date(snapshot.disconnectedAt)
                : null,
              active: false,
              clockSkewMs: snapshot.clockSkewMs,
              messages: snapshot.messages,
              logic: snapshot.logic,
            },
          },
          { upsert: true }
        )
        .exec();
    } catch (error) {
      this.logger.error(
        `Failed to persist MQTT performance session. sessionId=${snapshot.sessionId} error=${(error as Error).message}`
      );
    }
  }

  private getActiveSession(
    deviceMac: string,
    clientId: string
  ): MutableMqttPerformanceSession | null {
    const normalizedMac = deviceMac.trim().toUpperCase();
    const session = this.activeSessionsByMac.get(normalizedMac);
    if (!session || session.clientId !== clientId) return null;
    return session;
  }

  private createTimingStats(): MutableTimingStats {
    return {
      count: 0,
      totalMs: 0,
      avgMs: null,
      minMs: null,
      maxMs: null,
      p95Ms: null,
      lastMs: null,
      samples: [],
    };
  }

  private addTimingSample(stats: MutableTimingStats, valueMs: number): void {
    if (!Number.isFinite(valueMs) || valueMs < 0) return;

    const rounded = this.round(valueMs);
    stats.count += 1;
    stats.totalMs += valueMs;
    stats.avgMs = this.round(stats.totalMs / stats.count);
    stats.minMs =
      stats.minMs === null
        ? rounded
        : this.round(Math.min(stats.minMs, valueMs));
    stats.maxMs =
      stats.maxMs === null
        ? rounded
        : this.round(Math.max(stats.maxMs, valueMs));
    stats.lastMs = rounded;
    stats.samples.push(valueMs);
    if (stats.samples.length > MAX_TIMING_SAMPLES) {
      stats.samples.shift();
    }
    stats.p95Ms = this.percentile(stats.samples, 0.95);
  }

  private percentile(samples: number[], percentile: number): number | null {
    if (!samples.length) return null;
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.ceil(percentile * sorted.length) - 1;
    return this.round(sorted[Math.max(0, Math.min(index, sorted.length - 1))]);
  }

  private toSnapshot(
    session: MutableMqttPerformanceSession
  ): MqttPerformanceSession {
    return {
      ...session,
      messages: {
        ...session.messages,
        latency: this.toTimingSnapshot(session.messages.latency),
        recentMessages: [...session.messages.recentMessages],
      },
      logic: {
        ...session.logic,
        pipelineDuration: this.toTimingSnapshot(session.logic.pipelineDuration),
        pathDuration: this.toTimingSnapshot(session.logic.pathDuration),
        recentPaths: [...session.logic.recentPaths],
      },
    };
  }

  private toTimingSnapshot(stats: MutableTimingStats): TimingStats {
    return {
      count: stats.count,
      avgMs: stats.avgMs,
      minMs: stats.minMs,
      maxMs: stats.maxMs,
      p95Ms: stats.p95Ms,
      lastMs: stats.lastMs,
    };
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
