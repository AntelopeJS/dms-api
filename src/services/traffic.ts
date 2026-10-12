import type { RouteStatisticsModel } from "@/db";
import type { RequestLogSample } from "@/db/models/request_log.model";
import type { RouteStatistics } from "@/db/tables/routes_statistics.table";
import type { DayStatistics } from "@/types";
import { cached } from "./aggregate-cache";
import { scopeRouteKey } from "./scope";
import {
  emptyHistogram,
  exactQuantile,
  histogramQuantile,
  latencyBucketIndex,
} from "./statistics-utils";
import {
  rangeKey,
  samplesIn,
  type SampleSource,
  type ScopeKeys,
  scanSamples,
  timeOf,
} from "./traffic-samples";
import {
  bucketOf,
  bucketStarts,
  CACHE_QUANTUM_MS,
  horizonOf,
  type TimeRange,
  type WindowGranularity,
} from "./window";

export {
  forgetRecentScan,
  loadErrorSamples,
  loadSamples,
  RECENT_SPAN_MS,
  type SampleSource,
  type ScopeKeys,
} from "./traffic-samples";

/** What the traffic reads of the day rollups: all of them. */
export type RollupSource = Pick<RouteStatisticsModel, "getAll">;
/** The two stores a window's traffic is read from. */
export interface TrafficModels {
  logs: SampleSource;
  stats: RollupSource;
}

/** Requests of one bucket of time, split by outcome. */
export interface TrafficBucket {
  start: number;
  requests: number;
  clientErrors: number;
  serverErrors: number;
  /** Sum and extremes of the measured durations. */
  totalLatency: number;
  maxLatency: number;
  minLatency: number;
  /** Calls whose duration was measured. */
  timed: number;
  /**
   * Measured durations per bucket of `LATENCY_BUCKETS_MS`, what a p95 is
   * estimated from when the durations are not kept.
   */
  histogram: number[];
  /**
   * Every measured duration, while every part of the bucket comes from the
   * logs: the p95 is then exact. Null (or absent) once a day rollup is in.
   */
  durations?: number[] | null;
}

export function emptyBucket(start: number): TrafficBucket {
  return {
    start,
    requests: 0,
    clientErrors: 0,
    serverErrors: 0,
    totalLatency: 0,
    maxLatency: 0,
    minLatency: 0,
    timed: 0,
    histogram: emptyHistogram(),
    durations: [],
  };
}

function addLatency(bucket: TrafficBucket, min: number, max: number): void {
  bucket.minLatency =
    bucket.timed === 0 ? min : Math.min(bucket.minLatency, min);
  bucket.maxLatency = Math.max(bucket.maxLatency, max);
}

/** The duration of a logged call, or null when it was not measured. */
export function durationOf(
  sample: Pick<RequestLogSample, "responseTimeMs">,
): number | null {
  const ms = sample.responseTimeMs as number | null | undefined;
  return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
}

/** Fold one logged request into its bucket. */
export function addSample(
  bucket: TrafficBucket,
  sample: Pick<RequestLogSample, "statusCode" | "responseTimeMs">,
): void {
  const ms = durationOf(sample);
  if (ms !== null) {
    addLatency(bucket, ms, ms);
    bucket.totalLatency += ms;
    bucket.histogram[latencyBucketIndex(ms)] += 1;
    bucket.durations?.push(ms);
    bucket.timed += 1;
  }
  bucket.requests += 1;
  if (sample.statusCode >= 500) bucket.serverErrors += 1;
  else if (sample.statusCode >= 400) bucket.clientErrors += 1;
}

/** Add the counts of `histogram` to the target's. */
function addHistogram(target: TrafficBucket, histogram: number[]): void {
  histogram.forEach((count, index) => {
    target.histogram[index] += count;
  });
}

/** Add the durations of a part holding `timed` measured calls. */
function addDurations(
  target: TrafficBucket,
  durations: number[] | null | undefined,
  timed: number,
): void {
  if (timed === 0 || !target.durations) return;
  if (!durations) {
    target.durations = null;
    return;
  }
  for (const ms of durations) target.durations.push(ms);
}

/** Fold one day rollup into its bucket. */
export function addDay(bucket: TrafficBucket, day: DayStatistics): void {
  if (day.requestsCount === 0) return;
  const timed = day.timedRequestsCount;
  if (timed > 0) addLatency(bucket, day.minResponseTime, day.maxResponseTime);
  addDurations(bucket, null, timed);
  bucket.timed += timed;
  bucket.requests += day.requestsCount;
  bucket.totalLatency += day.totalResponseTime;
  bucket.clientErrors += day.clientErrorsCount;
  bucket.serverErrors += day.serverErrorsCount;
  addHistogram(bucket, day.latencyHistogram);
}

/** Fold `bucket` into `total`. */
function addBucket(total: TrafficBucket, bucket: TrafficBucket): void {
  if (bucket.requests === 0) return;
  if (bucket.timed > 0) {
    addLatency(total, bucket.minLatency, bucket.maxLatency);
  }
  addDurations(total, bucket.durations, bucket.timed);
  total.timed += bucket.timed;
  total.requests += bucket.requests;
  total.totalLatency += bucket.totalLatency;
  total.clientErrors += bucket.clientErrors;
  total.serverErrors += bucket.serverErrors;
  addHistogram(total, bucket.histogram);
}

/** The sum of `buckets`, as one bucket starting at the first. */
export function sumBuckets(buckets: TrafficBucket[]): TrafficBucket {
  const total = emptyBucket(buckets[0]?.start ?? 0);
  for (const bucket of buckets) addBucket(total, bucket);
  return total;
}

/** Average of the measured durations; 0 without any. */
export function averageLatency(bucket: TrafficBucket): number {
  const timed = bucket.timed;
  return timed > 0 ? bucket.totalLatency / timed : 0;
}

const P95 = 0.95;

/**
 * The p95 of the measured durations: the one reading every block shares, so
 * a route has one p95 per window wherever it is shown. Exact (nearest rank)
 * while the bucket kept its durations, which every window read from the logs
 * does; estimated from the histogram otherwise, always within the bucket's
 * min and max. Null without a measured call.
 */
export function p95Latency(bucket: TrafficBucket): number | null {
  if (bucket.timed === 0) return null;
  if (bucket.durations?.length) return exactQuantile(bucket.durations, P95);
  return histogramQuantile(bucket.histogram, P95, {
    min: bucket.minLatency,
    max: bucket.maxLatency,
  });
}

/** Share (0-1) of the calls answered with a 4xx or a 5xx. */
export function errorShare(bucket: TrafficBucket): number {
  return bucket.requests > 0
    ? (bucket.clientErrors + bucket.serverErrors) / bucket.requests
    : 0;
}

/** Share (0-1) of the calls answered with a 5xx. */
export function serverErrorShare(bucket: TrafficBucket): number {
  return bucket.requests > 0 ? bucket.serverErrors / bucket.requests : 0;
}

/** Share (0-1) of the calls answered with a 4xx. */
export function clientErrorShare(bucket: TrafficBucket): number {
  return bucket.requests > 0 ? bucket.clientErrors / bucket.requests : 0;
}

// ---------------------------------------------------------------------------
// Bucketed traffic, per route
// ---------------------------------------------------------------------------

/** Per-route traffic over a window, every route bucketed on the same starts. */
export interface WindowTraffic {
  starts: number[];
  routes: Map<string, TrafficBucket[]>;
}

function emptyBuckets(starts: number[]): TrafficBucket[] {
  return starts.map(emptyBucket);
}

/** Per-route traffic of `samples` bucketed on `starts`. */
export function bucketSamplesByRoute(
  samples: RequestLogSample[],
  starts: number[],
  granularity: WindowGranularity,
): Map<string, TrafficBucket[]> {
  const index = new Map(starts.map((start, position) => [start, position]));
  const routes = new Map<string, TrafficBucket[]>();
  for (const sample of samples) {
    const position = index.get(bucketOf(timeOf(sample), granularity));
    if (position === undefined) continue;
    const key = scopeRouteKey(sample.method, sample.uri);
    let buckets = routes.get(key);
    if (!buckets) {
      buckets = emptyBuckets(starts);
      routes.set(key, buckets);
    }
    addSample(buckets[position], sample);
  }
  return routes;
}

/** One minute of one route on a past day: what a partial day is summed from. */
interface MinuteTraffic {
  minute: number;
  bucket: TrafficBucket;
}

/** A past day of logs, per route and per minute. */
type DayProfile = Map<string, MinuteTraffic[]>;

/** A past day does not change: its profile is kept for hours. */
const PROFILE_TTL_MS = 6 * 60 * 60 * 1000;

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function nextDay(dayStart: number): number {
  const date = new Date(dayStart);
  date.setDate(date.getDate() + 1);
  return date.getTime();
}

/**
 * The minute-by-minute traffic of the day starting at `dayStart`, or null
 * when its logs are already pruned. A rolling 7-day window starts in the
 * middle of a day: the rollup of that day holds the whole of it, the profile
 * the part inside the window.
 */
function dayProfile(
  model: SampleSource,
  dayStart: number,
): Promise<DayProfile | null> {
  return cached(
    `profile:${dayStart}`,
    async () => {
      if (dayStart < horizonOf("hour", new Date()).getTime()) return null;
      const range = {
        from: new Date(dayStart),
        to: new Date(nextDay(dayStart)),
      };
      const { samples } = await scanSamples(model, range);
      const profile: DayProfile = new Map();
      for (const sample of samples) {
        const key = scopeRouteKey(sample.method, sample.uri);
        const minute = bucketOf(timeOf(sample), "minute");
        const minutes = profile.get(key) ?? [];
        let last = minutes[minutes.length - 1];
        if (!last || last.minute !== minute) {
          last = { minute, bucket: emptyBucket(minute) };
          minutes.push(last);
          profile.set(key, minutes);
        }
        addSample(last.bucket, sample);
      }
      return profile;
    },
    PROFILE_TTL_MS,
  );
}

/**
 * The part of a day bucket on one side of `boundary`, from its profile: its
 * own calls, durations and histogram, never the whole day's (a whole day's
 * p95 could exceed the part's max).
 */
function partialDay(
  day: TrafficBucket,
  minutes: MinuteTraffic[] | undefined,
  keep: (minute: number) => boolean,
): TrafficBucket {
  const part = emptyBucket(day.start);
  for (const entry of minutes ?? []) {
    if (keep(entry.minute)) addBucket(part, entry.bucket);
  }
  return part;
}

/** The day rollups, shared by the blocks of a page. */
export function loadRollups(model: RollupSource): Promise<RouteStatistics[]> {
  return cached("rollups", async () => model.getAll(), CACHE_QUANTUM_MS);
}

/**
 * Per-route day buckets over `range`, from the rollups. A bound that falls
 * inside a past day trims that day with its profile, so a rolling window and
 * the period before it split the day between them instead of both counting
 * all of it. Today's rollup already stops at now.
 */
async function dayTraffic(
  models: TrafficModels,
  range: TimeRange,
): Promise<WindowTraffic> {
  const starts = bucketStarts(range, "day");
  const from = range.from.getTime();
  const to = range.to.getTime();
  const today = startOfDay(Date.now());
  const headDay = startOfDay(from);
  const tailDay = startOfDay(to - 1);
  const [rollups, head, tail] = await Promise.all([
    loadRollups(models.stats),
    from > headDay ? dayProfile(models.logs, headDay) : null,
    to < nextDay(tailDay) && tailDay < today
      ? dayProfile(models.logs, tailDay)
      : null,
  ]);
  const index = new Map(starts.map((start, position) => [start, position]));
  const fromMinute = bucketOf(from, "minute");
  const toMinute = bucketOf(to, "minute");
  const routes = new Map<string, TrafficBucket[]>();
  for (const route of rollups) {
    const key = scopeRouteKey(route.method, route.uri);
    const buckets = emptyBuckets(starts);
    for (const day of route.statistics) {
      const position = index.get(day.day);
      if (position !== undefined) addDay(buckets[position], day);
    }
    if (head) {
      buckets[0] = partialDay(
        buckets[0],
        head.get(key),
        (minute) => minute >= fromMinute,
      );
    }
    if (tail) {
      const last = buckets.length - 1;
      buckets[last] = partialDay(
        buckets[last],
        tail.get(key),
        (minute) => minute < toMinute,
      );
    }
    routes.set(key, buckets);
  }
  return { starts, routes };
}

/**
 * Per-route traffic over `range`: minute and hour buckets from the logs, day
 * buckets from the rollups (which outlive the logs and are cheaper to read).
 * Cached per range, so every block of a page reads the same computation.
 */
export function windowTraffic(
  models: TrafficModels,
  range: TimeRange,
  granularity: WindowGranularity,
): Promise<WindowTraffic> {
  return cached(`traffic:${granularity}:${rangeKey(range)}`, async () => {
    if (granularity === "day") return dayTraffic(models, range);
    const starts = bucketStarts(range, granularity);
    const samples = await samplesIn(models.logs, range);
    return {
      starts,
      routes: bucketSamplesByRoute(samples, starts, granularity),
    };
  });
}

/** The traffic of the routes in scope, summed bucket by bucket. */
export function scopeTraffic(
  traffic: WindowTraffic,
  keys: ScopeKeys,
): TrafficBucket[] {
  const total = emptyBuckets(traffic.starts);
  for (const [key, buckets] of traffic.routes) {
    if (keys && !keys.has(key)) continue;
    buckets.forEach((bucket, position) => addBucket(total[position], bucket));
  }
  return total;
}

/** Traffic over `range` of the routes in scope, bucketed. */
export async function loadTraffic(
  models: TrafficModels,
  range: TimeRange,
  granularity: WindowGranularity,
  keys: ScopeKeys,
): Promise<TrafficBucket[]> {
  return scopeTraffic(await windowTraffic(models, range, granularity), keys);
}
