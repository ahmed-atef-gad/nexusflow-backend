import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { Collection } from 'mongodb';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { READINGS_TTL_SECONDS } from './schemas/sensor-reading.schema';

const COLLECTION_NAME = 'sensorreadings';
const DEFAULT_QUERY_LIMIT = 500;
const MAX_QUERY_LIMIT = 2000;
const THROTTLE_WINDOW_MS = 1000;
const THROTTLE_NS = 'readings:throttle:';

type SaveReadingParams = {
  flowId: string;
  nodeId: string;
  deviceMac: string;
  topic: string;
  readings: Record<string, number>;
};

type ReadingDocument = {
  recordedAt: Date;
  meta: {
    flowId: string;
    nodeId: string;
    deviceMac: string;
    topic: string;
  };
  readings: Record<string, number>;
};

@Injectable()
export class ReadingsService implements OnModuleInit {
  private readonly logger = new Logger(ReadingsService.name);

  private collection!: Collection<ReadingDocument>;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache
  ) {}

  /**
   * Ensure the time-series collection and its TTL index exist on startup.
   * Mongoose / MongooseModule cannot create time-series collections via the
   * standard schema API, so we do it imperatively here.
   */
  async onModuleInit(): Promise<void> {
    try {
      const db = this.connection.db;
      if (!db) {
        this.logger.warn('ReadingsService: db not available on connection yet');
        return;
      }

      const existing = await db
        .listCollections({ name: COLLECTION_NAME })
        .toArray();

      if (existing.length === 0) {
        await db.createCollection(COLLECTION_NAME, {
          timeseries: {
            timeField: 'recordedAt',
            metaField: 'meta',
            granularity: 'seconds',
          },
          expireAfterSeconds: READINGS_TTL_SECONDS,
        });
        this.logger.log(
          `Created time-series collection "${COLLECTION_NAME}" with TTL=${READINGS_TTL_SECONDS}s`
        );
      }

      this.collection = db.collection<ReadingDocument>(COLLECTION_NAME);
      this.logger.log(
        `ReadingsService ready — collection="${COLLECTION_NAME}"`
      );
    } catch (err) {
      this.logger.error(
        `ReadingsService init failed: ${(err as Error).message}`
      );
    }
  }

  /**
   * Fire-and-forget save with per-node throttling (max 1/sec).
   * Errors are swallowed so MQTT processing is never interrupted.
   */
  saveReadingThrottled(params: SaveReadingParams): void {
    if (!this.collection) return;
    if (!Object.keys(params.readings).length) return;

    const throttleKey = THROTTLE_NS + `${params.flowId}:${params.nodeId}`;

    // Fire-and-forget throttle check + save
    this.cacheManager
      .get<true>(throttleKey)
      .then((throttled) => {
        if (throttled) return; // within throttle window — skip
        return this.cacheManager
          .set(throttleKey, true, THROTTLE_WINDOW_MS)
          .then(() => this.persistReading(params));
      })
      .catch((err: unknown) => {
        this.logger.error(
          `Failed to persist reading for ${params.flowId}:${params.nodeId}: ${
            (err as Error).message
          }`
        );
      });
  }

  private async persistReading(params: SaveReadingParams): Promise<void> {
    const doc: ReadingDocument = {
      recordedAt: new Date(),
      meta: {
        flowId: params.flowId,
        nodeId: params.nodeId,
        deviceMac: params.deviceMac,
        topic: params.topic,
      },
      readings: params.readings,
    };
    await this.collection.insertOne(doc);
  }

  /**
   * Retrieve historical readings for a node within an optional time range.
   * Results are sorted oldest-first (ascending recordedAt).
   */
  async getReadings(
    flowId: string,
    nodeId: string,
    from?: Date,
    to?: Date,
    limit?: number
  ): Promise<ReadingDocument[]> {
    if (!this.collection) return [];

    const clampedLimit = Math.min(
      Math.max(1, limit ?? DEFAULT_QUERY_LIMIT),
      MAX_QUERY_LIMIT
    );

    const timeFilter: Record<string, Date> = {};
    if (from) timeFilter.$gte = from;
    if (to) timeFilter.$lte = to;

    const filter: Record<string, unknown> = {
      'meta.flowId': flowId,
      'meta.nodeId': nodeId,
    };
    if (Object.keys(timeFilter).length) {
      filter.recordedAt = timeFilter;
    }

    const pipeline = [
      { $match: filter },
      { $sort: { recordedAt: 1 } },
      {
        $bucketAuto: {
          groupBy: '$recordedAt',
          buckets: clampedLimit,
          output: {
            doc: { $first: '$$ROOT' },
          },
        },
      },
      { $replaceRoot: { newRoot: '$doc' } },
    ];

    return this.collection.aggregate<ReadingDocument>(pipeline).toArray();
  }

  /**
   * Return the most recent reading for a node — useful for dashboard widgets.
   */
  async getLatestReading(
    flowId: string,
    nodeId: string
  ): Promise<ReadingDocument | null> {
    if (!this.collection) return null;

    const result = await this.collection
      .find({ 'meta.flowId': flowId, 'meta.nodeId': nodeId })
      .sort({ recordedAt: -1 })
      .limit(1)
      .toArray();

    return result[0] ?? null;
  }
}
