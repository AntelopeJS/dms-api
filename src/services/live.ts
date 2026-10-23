import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from "@/types";
import { getMaxLogDays } from "./period";
import {
  addSample,
  emptyBucket,
  loadSamples,
  minuteCounts,
  RECENT_SPAN_MS,
  type SampleSource,
  type ScopeKeys,
  sumBuckets,
  type TrafficBucket,
} from "./traffic";
import {
  CACHE_QUANTUM_MS,
  currentRange,
  isWindowPreset,
  parseDate,
  pinnedNow,
  type TimeRange,
  type WindowPreset,
  type WindowQuery,
} from "./window";

/** One bar of the live histogram. */
export interface LiveBucket {
  start: number;
  success: number;
  clientErrors: number;
  serverErrors: number;
}

/**
 * The period the histogram covers: a preset of the page's selector, every
 * request kept (`all`), or a custom range (`null`).
 */
export type LivePeriod = WindowPreset | "all" | null;

export interface LiveTraffic {
  buckets: LiveBucket[];
  total: number;
  clientErrors: number;
  serverErrors: number;
  refreshedAt: string;
  /** The length of a bar, in ms. */
  bucketMs: number;
  period: LivePeriod;
  /** The range read, `[from, to)`, clamped to the log retention. */
  from: string;
  to: string;
  /** Whether the range reaches now: the bars follow the live feed. */
  live: boolean;
}

/**
 * The bar lengths the histogram picks from, shortest first: each one a
 * divisor of the next round unit, so the bars line up on the clock.
 */
const LIVE_BUCKET_SIZES_MS = [
  MS_PER_MINUTE,
  2 * MS_PER_MINUTE,
  5 * MS_PER_MINUTE,
  10 * MS_PER_MINUTE,
  15 * MS_PER_MINUTE,
  30 * MS_PER_MINUTE,
  MS_PER_HOUR,
  2 * MS_PER_HOUR,
  3 * MS_PER_HOUR,
  6 * MS_PER_HOUR,
  12 * MS_PER_HOUR,
  MS_PER_DAY,
] as const;

/** The most bars a period is drawn with by default: 1H 60, 24H 96, 30D 120. */
const TARGET_MAX_BARS = 120;
/** The most bars a bar length asked for may draw. */
const MAX_BARS = 240;

/**
 * The bar length of a period of `spanMs`: the shortest that draws it in at
 * most {@link TARGET_MAX_BARS} bars. 1 hour: 1 min (60 bars); 24 hours:
 * 15 min (96); 7 days: 2 h (84); 30 days: 6 h (120). Beyond 120 days, a day.
 */
export function liveBucketMs(spanMs: number): number {
  const span = Math.max(spanMs, MS_PER_MINUTE);
  return (
    LIVE_BUCKET_SIZES_MS.find((size) => span / size <= TARGET_MAX_BARS) ??
    MS_PER_DAY
  );
}

/**
 * The bar length a request asks for (`bucket`, in ms), when it is one of
 * {@link LIVE_BUCKET_SIZES_MS} and draws the period in at most
 * {@link MAX_BARS} bars; the period's own otherwise.
 */
export function resolveBucketMs(
  raw: string | undefined,
  spanMs: number,
): number {
  const asked = Number(raw);
  const allowed = LIVE_BUCKET_SIZES_MS.find((size) => size === asked);
  if (allowed && spanMs / allowed <= MAX_BARS) return allowed;
  return liveBucketMs(spanMs);
}

/** The period of the histogram when the request names none: the last hour. */
const DEFAULT_LIVE_PRESET: WindowPreset = "last-hour";

/** What the histogram reads of a request: the page's period and a bar length. */
export interface LiveQuery extends WindowQuery {
  bucket?: string;
}

/**
 * The period a request names, clamped to the log retention: a preset up to
 * now, `all` for every request kept, else its custom `from` / `to` (never
 * past now), else the last hour.
 */
export function liveRange(
  query: LiveQuery,
  now: Date,
): { period: LivePeriod; range: TimeRange } {
  const horizon = now.getTime() - getMaxLogDays() * MS_PER_DAY;
  const clamp = (range: TimeRange): TimeRange => ({
    from: new Date(Math.max(range.from.getTime(), horizon)),
    to: new Date(
      Math.max(Math.min(range.to.getTime(), now.getTime()), horizon),
    ),
  });
  if (query.preset === "all") {
    return {
      period: "all",
      range: clamp({ from: new Date(horizon), to: now }),
    };
  }
  const preset = isWindowPreset(query.preset) ? query.preset : null;
  const custom =
    !preset && Boolean(parseDate(query.from) || parseDate(query.to));
  const period = custom ? null : (preset ?? DEFAULT_LIVE_PRESET);
  return {
    period,
    range: clamp(currentRange(query, period, DEFAULT_LIVE_PRESET, now)),
  };
}

/** Offset of the server's clock from UTC, for bars of hours to start on the hour. */
function localOffset(at: number): number {
  return -new Date(at).getTimezoneOffset() * MS_PER_MINUTE;
}

/** Start of the bar of `bucketMs` that `at` falls in, on the local clock. */
export function barOf(at: number, bucketMs: number): number {
  const offset = localOffset(at);
  return Math.floor((at + offset) / bucketMs) * bucketMs - offset;
}

/**
 * Requests per bar over the page's period, split by status class: every
 * route in scope, whatever the table's filters. A period of a day at most
 * is read from the logs, which the live blocks share; a longer one from the
 * calls per minute of each day, so a month does not read every request.
 */
export async function getLiveTraffic(
  model: SampleSource,
  keys: ScopeKeys,
  query: LiveQuery = {},
  now: Date = new Date(),
): Promise<LiveTraffic> {
  const pinned = pinnedNow(now);
  const { period, range } = liveRange(query, pinned);
  const from = range.from.getTime();
  const to = range.to.getTime();
  const bucketMs = resolveBucketMs(query.bucket, to - from);
  const live = to >= pinned.getTime() - CACHE_QUANTUM_MS;
  // A period reaching now ends on the bar still running, and keeps its
  // count of bars (the last hour: 60) as the clock moves; a past one covers
  // its range with whole bars.
  const last = barOf(live ? to : Math.max(to - 1, from), bucketMs);
  const barCount = live
    ? Math.ceil((to - from) / bucketMs)
    : Math.floor((last - barOf(from, bucketMs)) / bucketMs) + 1;
  const count = Math.min(Math.max(barCount, 1), MAX_BARS);
  const start = last - (count - 1) * bucketMs;
  const bars = Array.from({ length: count }, (_, index) =>
    emptyBucket(start + index * bucketMs),
  );
  const barAt = (at: number): TrafficBucket | undefined =>
    bars[Math.floor((at - start) / bucketMs)];
  if (to - from <= RECENT_SPAN_MS) {
    for (const sample of await loadSamples(model, range, keys)) {
      const bar = barAt(new Date(sample.timestamp).getTime());
      if (bar) addSample(bar, sample);
    }
  } else {
    for (const minute of await minuteCounts(model, range, keys)) {
      const bar = barAt(minute.minute);
      if (!bar) continue;
      bar.requests += minute.requests;
      bar.clientErrors += minute.clientErrors;
      bar.serverErrors += minute.serverErrors;
    }
  }
  const total = sumBuckets(bars);
  return {
    buckets: bars.map((bar) => ({
      start: bar.start,
      success: bar.requests - bar.clientErrors - bar.serverErrors,
      clientErrors: bar.clientErrors,
      serverErrors: bar.serverErrors,
    })),
    total: total.requests,
    clientErrors: total.clientErrors,
    serverErrors: total.serverErrors,
    refreshedAt: now.toISOString(),
    bucketMs,
    period,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    live,
  };
}
