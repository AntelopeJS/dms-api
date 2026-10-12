import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from "@/types";
import { getMaxLogDays, getMaxStatsDays } from "./period";

/**
 * The one definition of a time window, for every endpoint and every link.
 *
 * A window is a half-open range `[from, to)`. The presets are rolling:
 * `last-24h` is the 24 hours before now, `last-7-days` the 7 × 24 hours
 * before now, the same span the logs page filters on. The previous period has
 * the same length and ends where the window starts, so no request is counted
 * in both.
 */

/**
 * The presets every page's DMS `PeriodSelector` offers, by their DMS names:
 * what its period scope sends (`preset`) and what its URL holds
 * (`?api.period=last-24h`).
 */
export const WINDOW_PRESETS = [
  "last-hour",
  "last-24h",
  "last-7-days",
  "last-30-days",
] as const;
export type WindowPreset = (typeof WINDOW_PRESETS)[number];

/** The period of every page when neither its URL nor the user names one. */
export const DEFAULT_WINDOW: WindowPreset = "last-24h";

/**
 * Id of the `PeriodSelector` of every console page: the period scope its
 * blocks follow, and the prefix of its URL keys (`?api.period=last-24h`).
 */
export const PERIOD_SCOPE = "api";

/** The URL key the page's period is kept under. */
export const PERIOD_QUERY_KEY = `${PERIOD_SCOPE}.period`;

/**
 * The URL keys of a range the page opens on instead of a preset (an
 * incident's): ISO bounds the `PeriodSelector` takes even though it offers
 * no custom range.
 */
export const PERIOD_FROM_KEY = `${PERIOD_SCOPE}.from`;
export const PERIOD_TO_KEY = `${PERIOD_SCOPE}.to`;

const PRESET_SPAN_MS: Record<WindowPreset, number> = {
  "last-hour": MS_PER_HOUR,
  "last-24h": MS_PER_DAY,
  "last-7-days": 7 * MS_PER_DAY,
  "last-30-days": 30 * MS_PER_DAY,
};

export function isWindowPreset(value: unknown): value is WindowPreset {
  return WINDOW_PRESETS.includes(value as WindowPreset);
}

/**
 * What a request says about its window, as the DMS period scope sends it to
 * a chart, a card or a source table: `preset`, `from` / `to` (its own reading
 * of the preset), `comparison` and `compareFrom` / `compareTo`. A preset we
 * know wins over its range, rolling up to now; a custom range is taken as
 * given.
 */
export interface WindowQuery {
  preset?: string;
  from?: string;
  to?: string;
  comparison?: string;
  compareFrom?: string;
  compareTo?: string;
}

const WINDOW_QUERY_KEYS = [
  "preset",
  "from",
  "to",
  "comparison",
  "compareFrom",
  "compareTo",
] as const;

/** The window parameters of a request URL, or of a list query. */
export function windowQueryFrom(
  params: URLSearchParams | Record<string, string | undefined>,
): WindowQuery {
  const read = (key: string) =>
    params instanceof URLSearchParams ? params.get(key) : params[key];
  const query: WindowQuery = {};
  for (const key of WINDOW_QUERY_KEYS) {
    const value = read(key);
    if (value) query[key] = value;
  }
  return query;
}

/**
 * Bucket size: a minute up to an hour (60 points), an hour up to two days,
 * a day beyond. Minute and hour buckets come from the raw request logs, day
 * buckets from the day rollups.
 */
export type WindowGranularity = "minute" | "hour" | "day";

export interface TimeRange {
  from: Date;
  to: Date;
}

export interface TimeWindow extends TimeRange {
  /** The preset the window follows; null for a custom range. */
  preset: WindowPreset | null;
  granularity: WindowGranularity;
  /** Same length, right before: what deltas compare to; null when not asked or not kept. */
  previous: TimeRange | null;
  /**
   * Whether the previous period is still stored. With a 30-day retention the
   * period before a 30-day window is already pruned: the comparison says so
   * rather than comparing to zeros.
   */
  previousAvailable: boolean;
}

/**
 * The aggregations are cached per range, and "now" moves on every call: it is
 * pinned to this step so the blocks of one page share their range. A window
 * lags the clock by less than this.
 */
export const CACHE_QUANTUM_MS = 5_000;

/** `now`, rounded down to {@link CACHE_QUANTUM_MS}. */
export function pinnedNow(now: Date = new Date()): Date {
  return new Date(
    Math.floor(now.getTime() / CACHE_QUANTUM_MS) * CACHE_QUANTUM_MS,
  );
}

/** The range a preset covers, ending at `now`. */
export function presetRange(
  preset: WindowPreset,
  now: Date = pinnedNow(),
): TimeRange {
  return { from: new Date(now.getTime() - PRESET_SPAN_MS[preset]), to: now };
}

const MINUTE_MAX_SPAN_MS = MS_PER_HOUR;
const HOURLY_MAX_SPAN_MS = 2 * MS_PER_DAY;
const NO_COMPARISON = "none";
const CUSTOM_COMPARISON = "custom";

export function granularityOf(range: TimeRange): WindowGranularity {
  const span = range.to.getTime() - range.from.getTime();
  if (span <= MINUTE_MAX_SPAN_MS) return "minute";
  return span <= HOURLY_MAX_SPAN_MS ? "hour" : "day";
}

export function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * The oldest instant a window of `granularity` can still be read from: the
 * request logs for minute and hour buckets, the day rollups (pruned by whole
 * days) for day buckets.
 */
export function horizonOf(granularity: WindowGranularity, now: Date): Date {
  if (granularity === "day") {
    return new Date(startOfDay(now.getTime()) - getMaxStatsDays() * MS_PER_DAY);
  }
  return new Date(now.getTime() - getMaxLogDays() * MS_PER_DAY);
}

function orderedRange(from: Date, to: Date): TimeRange {
  return from < to ? { from, to } : { from: to, to: from };
}

/**
 * The range a query names before any clamp: its preset up to `now`, else its
 * custom `from` / `to`, else the `fallback` preset.
 */
export function currentRange(
  query: WindowQuery,
  preset: WindowPreset | null,
  fallback: WindowPreset,
  now: Date,
): TimeRange {
  if (preset) return presetRange(preset, now);
  const to = parseDate(query.to) ?? now;
  const from =
    parseDate(query.from) ?? new Date(to.getTime() - PRESET_SPAN_MS[fallback]);
  return orderedRange(from, to);
}

function previousRange(query: WindowQuery, range: TimeRange): TimeRange {
  const compareFrom = parseDate(query.compareFrom);
  const compareTo = parseDate(query.compareTo);
  if (query.comparison === CUSTOM_COMPARISON && compareFrom && compareTo) {
    return orderedRange(compareFrom, compareTo);
  }
  const span = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - span), to: range.from };
}

/**
 * The window a request names, clamped to what is still stored. Without any
 * window parameter, the `fallback` preset.
 */
export function resolveWindow(
  query: WindowQuery,
  fallback: WindowPreset,
  now: Date = new Date(),
): TimeWindow {
  const pinned = pinnedNow(now);
  const customRange = Boolean(query.from || query.to);
  const preset = isWindowPreset(query.preset)
    ? query.preset
    : customRange
      ? null
      : fallback;
  const range = currentRange(query, preset, fallback, pinned);
  const granularity = granularityOf(range);
  const horizon = horizonOf(granularity, pinned);
  const clamped: TimeRange = {
    from: range.from < horizon ? horizon : range.from,
    to: range.to,
  };
  const previous = previousRange(query, clamped);
  const previousAvailable = previous.from >= horizon;
  return {
    ...clamped,
    preset,
    granularity,
    previous:
      query.comparison === NO_COMPARISON || !previousAvailable
        ? null
        : previous,
    previousAvailable,
  };
}

/** What a payload says about the window it covers, for the cards to print. */
export interface WindowInfo {
  preset: WindowPreset | null;
  from: string;
  to: string;
  granularity: WindowGranularity;
  previous: { from: string; to: string } | null;
  previousAvailable: boolean;
}

export function describeWindow(window: TimeWindow): WindowInfo {
  return {
    preset: window.preset,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    granularity: window.granularity,
    previous: window.previous
      ? {
          from: window.previous.from.toISOString(),
          to: window.previous.to.toISOString(),
        }
      : null,
    previousAvailable: window.previousAvailable,
  };
}

/** Start of the bucket `timestamp` falls in. */
export function bucketOf(
  timestamp: number,
  granularity: WindowGranularity,
): number {
  if (granularity === "minute") {
    return Math.floor(timestamp / MS_PER_MINUTE) * MS_PER_MINUTE;
  }
  const date = new Date(timestamp);
  if (granularity === "hour") {
    date.setMinutes(0, 0, 0);
  } else {
    date.setHours(0, 0, 0, 0);
  }
  return date.getTime();
}

function nextBucket(start: number, granularity: WindowGranularity): number {
  if (granularity === "minute") return start + MS_PER_MINUTE;
  if (granularity === "hour") return start + MS_PER_HOUR;
  const date = new Date(start);
  date.setDate(date.getDate() + 1);
  return date.getTime();
}

/**
 * Bucket start times covering `[range.from, range.to)`, oldest first: the
 * first bucket holds `from`, the last one starts before `to`.
 */
export function bucketStarts(
  range: TimeRange,
  granularity: WindowGranularity,
): number[] {
  const starts: number[] = [];
  const end = range.to.getTime();
  for (
    let cursor = bucketOf(range.from.getTime(), granularity);
    cursor < end;
    cursor = nextBucket(cursor, granularity)
  ) {
    starts.push(cursor);
  }
  return starts;
}
