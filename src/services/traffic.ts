import type { RequestLogModel, RouteStatisticsModel } from "@/db";
import type { RequestLogSample } from "@/db/models/request_log.model";
import type { RouteStatistics } from "@/db/tables/routes_statistics.table";
import type { DayStatistics } from "@/types";
import { scopeRouteKey } from "./scope";
import {
  bucketOf,
  bucketStarts,
  type TimeRange,
  type WindowGranularity,
} from "./window";

/** Requests of one bucket of time, split by outcome. */
export interface TrafficBucket {
  start: number;
  requests: number;
  clientErrors: number;
  serverErrors: number;
  totalLatency: number;
  maxLatency: number;
  minLatency: number;
}

/** Route scope: `METHOD:uri` keys, or null for every route. */
export type ScopeKeys = Set<string> | null;

function emptyBucket(start: number): TrafficBucket {
  return {
    start,
    requests: 0,
    clientErrors: 0,
    serverErrors: 0,
    totalLatency: 0,
    maxLatency: 0,
    minLatency: 0,
  };
}

function addLatency(bucket: TrafficBucket, min: number, max: number): void {
  bucket.minLatency =
    bucket.requests === 0 ? min : Math.min(bucket.minLatency, min);
  bucket.maxLatency = Math.max(bucket.maxLatency, max);
}

/** Fold one logged request into its bucket. */
export function addSample(
  bucket: TrafficBucket,
  sample: Pick<RequestLogSample, "statusCode" | "responseTimeMs">,
): void {
  addLatency(bucket, sample.responseTimeMs, sample.responseTimeMs);
  bucket.requests += 1;
  bucket.totalLatency += sample.responseTimeMs;
  if (sample.statusCode >= 500) bucket.serverErrors += 1;
  else if (sample.statusCode >= 400) bucket.clientErrors += 1;
}

/** Fold one day rollup into its bucket. */
export function addDay(bucket: TrafficBucket, day: DayStatistics): void {
  if (day.requestsCount === 0) return;
  addLatency(bucket, day.minResponseTime, day.maxResponseTime);
  bucket.requests += day.requestsCount;
  bucket.totalLatency += day.totalResponseTime;
  bucket.clientErrors += day.clientErrorsCount;
  bucket.serverErrors += day.serverErrorsCount;
}

/** The sum of `buckets`, as one bucket starting at the first. */
export function sumBuckets(buckets: TrafficBucket[]): TrafficBucket {
  const total = emptyBucket(buckets[0]?.start ?? 0);
  for (const bucket of buckets) {
    if (bucket.requests === 0) continue;
    addLatency(total, bucket.minLatency, bucket.maxLatency);
    total.requests += bucket.requests;
    total.totalLatency += bucket.totalLatency;
    total.clientErrors += bucket.clientErrors;
    total.serverErrors += bucket.serverErrors;
  }
  return total;
}

export function averageLatency(bucket: TrafficBucket): number {
  return bucket.requests > 0 ? bucket.totalLatency / bucket.requests : 0;
}

export function errorShare(bucket: TrafficBucket): number {
  return bucket.requests > 0
    ? (bucket.clientErrors + bucket.serverErrors) / bucket.requests
    : 0;
}

function inScope(keys: ScopeKeys, method: string, uri: string): boolean {
  return !keys || keys.has(scopeRouteKey(method, uri));
}

/** Per-bucket traffic of `samples` over `range`. */
export function bucketSamples(
  samples: RequestLogSample[],
  range: TimeRange,
  granularity: WindowGranularity,
): TrafficBucket[] {
  const buckets = new Map(
    bucketStarts(range, granularity).map((start) => [
      start,
      emptyBucket(start),
    ]),
  );
  for (const sample of samples) {
    const bucket = buckets.get(
      bucketOf(new Date(sample.timestamp).getTime(), granularity),
    );
    if (bucket) addSample(bucket, sample);
  }
  return [...buckets.values()];
}

/** Per-day traffic of the rollups in scope over `range`. */
export function bucketRollups(
  rollups: RouteStatistics[],
  range: TimeRange,
  keys: ScopeKeys,
): TrafficBucket[] {
  const buckets = new Map(
    bucketStarts(range, "day").map((start) => [start, emptyBucket(start)]),
  );
  for (const route of rollups) {
    if (!inScope(keys, route.method, route.uri)) continue;
    for (const day of route.statistics) {
      const bucket = buckets.get(day.day);
      if (bucket) addDay(bucket, day);
    }
  }
  return [...buckets.values()];
}

/** Logged requests in scope over `range`, reduced to what aggregations read. */
export async function loadSamples(
  model: RequestLogModel,
  range: TimeRange,
  keys: ScopeKeys,
): Promise<RequestLogSample[]> {
  if (keys && keys.size === 0) return [];
  return model.samples({
    since: range.from,
    until: range.to,
    routeKeys: keys ? [...keys] : undefined,
  });
}

/**
 * Traffic over `range`, bucketed: hour buckets from the raw logs, day buckets
 * from the rollups (which outlive the logs and are cheaper to read).
 */
export async function loadTraffic(
  models: { logs: RequestLogModel; stats: RouteStatisticsModel },
  range: TimeRange,
  granularity: WindowGranularity,
  keys: ScopeKeys,
): Promise<TrafficBucket[]> {
  if (granularity === "hour") {
    return bucketSamples(
      await loadSamples(models.logs, range, keys),
      range,
      granularity,
    );
  }
  return bucketRollups(await models.stats.getAll(), range, keys);
}
