import { Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

// 30-day TTL in seconds
export const READINGS_TTL_SECONDS = 30 * 24 * 60 * 60;

export type SensorReadingDocument = HydratedDocument<SensorReading>;

/**
 * SensorReading — stored in a MongoDB time-series collection.
 *
 * Time-series collections use columnar storage optimised for range queries
 * on a time field. The `meta` sub-document groups related measurements
 * together for efficient bucketing.
 *
 * Collection is created manually in ReadingsModule so we can pass
 * time-series options that Mongoose's @Schema decorator does not expose.
 */
@Schema()
export class SensorReading {
  /**
   * Server-side timestamp — the time-series time field.
   * A TTL index on this field expires documents after 30 days.
   */
  recordedAt: Date;

  /**
   * Grouping metadata (the time-series meta field).
   * MongoDB uses this to bucket related documents efficiently.
   */
  meta: {
    flowId: string;
    nodeId: string;
    deviceMac: string;
    topic: string;
  };

  /**
   * Numeric sensor readings extracted from the MQTT payload.
   * Keys are lowercase sensor-type names (e.g. temperature, humidity,
   * analog, digital, motion, distance_cm, value, result, raw, percent).
   */
  readings: Record<string, number>;
}

export const SensorReadingSchema = SchemaFactory.createForClass(SensorReading);
