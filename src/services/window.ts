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

/**
 * What a window is compared with, by the DMS names its `PeriodSelector`
 * sends (`comparison`): the period right before, the same period a year
 * before, the `compareFrom` / `compareTo` range, or nothing.
 */
export const WINDOW_COMPARISONS = [
  "previous-period",
  "previous-year",
  "custom",
  "none",
] as const;
export type WindowComparison = (typeof WINDOW_COMPARISONS)[number];

/**
 * The comparisons the monitoring pages offer, the one they open on first:
 * the dashed series, the deltas, the "vs" figures and their labels follow
 * the one picked. Only what the retention can show: the statistics behind
 * 7D and 30D are kept 90 days at most, and the logs behind 1H and 24H only
 * reach a year back when kept that long (30 days by default), so
 * "previous-year" (still resolved, for a link) would compare with nothing.
 * Offer it again if the statistics retention ever reaches a year.
 */
export const PAGE_COMPARISONS: WindowComparison[] = ["previous-period", "none"];
export const DEFAULT_COMPARISON: WindowComparison = "previous-period";

export interface TimeWindow extends TimeRange {
  /** The preset the window follows; null for a custom range. */
  preset: WindowPreset | null;
  granularity: WindowGranularity;
  /** What `previous` is: what the "vs" figures say they compare with. */
  comparison: WindowComparison;
  /** What deltas compare to; null when not asked or not kept. */
  previous: TimeRange | null;
  /**
   * Whether the period compared with is still stored; false without a
   * comparison. With a 30-day retention the period before a 30-day window,
   * and any period a year back, is already pruned: the comparison says so
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

/** `date` on the same day and time a year before (29 February: the 28th). */
function yearBefore(date: Date): Date {
  const shifted = new Date(date);
  shifted.setFullYear(shifted.getFullYear() - 1);
  // 29 February has no match a year before: setFullYear rolls it to 1 March.
  if (shifted.getMonth() !== date.getMonth()) shifted.setDate(0);
  return shifted;
}

/**
 * The comparison a query asks for. A custom one without both its bounds, and
 * anything we do not know (an older link, no `comparison` at all), compare
 * with the period right before.
 */
function comparisonOf(query: WindowQuery): WindowComparison {
  const asked = WINDOW_COMPARISONS.find((name) => name === query.comparison);
  if (asked === "custom") {
    const bounded = parseDate(query.compareFrom) && parseDate(query.compareTo);
    return bounded ? "custom" : DEFAULT_COMPARISON;
  }
  return asked ?? DEFAULT_COMPARISON;
}

/**
 * The range `range` is compared with, computed here rather than read from
 * `compareFrom` / `compareTo` (but for a custom comparison): the window rolls
 * up to our own pinned now, the selector's bounds to the browser's clock.
 */
function comparisonRange(
  comparison: Exclude<WindowComparison, "none">,
  query: WindowQuery,
  range: TimeRange,
): TimeRange {
  const compareFrom = parseDate(query.compareFrom);
  const compareTo = parseDate(query.compareTo);
  if (comparison === "custom" && compareFrom && compareTo) {
    return orderedRange(compareFrom, compareTo);
  }
  if (comparison === "previous-year") {
    return { from: yearBefore(range.from), to: yearBefore(range.to) };
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
  const comparison = comparisonOf(query);
  if (comparison === "none") {
    return {
      ...clamped,
      preset,
      granularity,
      comparison,
      previous: null,
      previousAvailable: false,
    };
  }
  const previous = comparisonRange(comparison, query, clamped);
  const previousAvailable = previous.from >= horizon;
  return {
    ...clamped,
    preset,
    granularity,
    comparison,
    previous: previousAvailable ? previous : null,
    previousAvailable,
  };
}

/** What a payload says about the window it covers, for the cards to print. */
export interface WindowInfo {
  preset: WindowPreset | null;
  from: string;
  to: string;
  granularity: WindowGranularity;
  comparison: WindowComparison;
  previous: { from: string; to: string } | null;
  previousAvailable: boolean;
}

export function describeWindow(window: TimeWindow): WindowInfo {
  return {
    preset: window.preset,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    granularity: window.granularity,
    comparison: window.comparison,
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
