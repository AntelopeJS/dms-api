import { MS_PER_DAY, MS_PER_HOUR } from "@/types";
import { getMaxLogDays, getMaxStatsDays } from "./period";

/**
 * The time window a period-scoped block asks for. The DMS `PeriodSelector`
 * appends `from` / `to` (ISO dates) and `comparison` to the fetch URL of every
 * block bound to it; a block fetched without a selector gets the fallback.
 */
export interface WindowQuery {
  from?: string;
  to?: string;
  comparison?: string;
}

export type WindowGranularity = "hour" | "day";

export interface TimeRange {
  from: Date;
  to: Date;
}

export interface TimeWindow extends TimeRange {
  /** Same length, right before: the comparison the delta is computed on. */
  previous: TimeRange | null;
  /**
   * Hour buckets come from the raw request logs, day buckets from the day
   * rollups. Up to two days, a day bucket would plot one or two points.
   */
  granularity: WindowGranularity;
}

const HOURLY_MAX_SPAN_MS = 2 * MS_PER_DAY;
const NO_COMPARISON = "none";

function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * The window a request names, clamped to what is still stored: the day
 * rollups for a day window, the raw logs for an hour window. A missing or
 * malformed range falls back to the last `fallbackDays` days.
 */
export function resolveWindow(
  query: WindowQuery,
  fallbackDays: number,
  now: Date = new Date(),
): TimeWindow {
  const to = parseDate(query.to) ?? now;
  const from =
    parseDate(query.from) ?? new Date(to.getTime() - fallbackDays * MS_PER_DAY);
  const ordered = from < to ? { from, to } : { from: to, to: from };
  const granularity: WindowGranularity =
    ordered.to.getTime() - ordered.from.getTime() <= HOURLY_MAX_SPAN_MS
      ? "hour"
      : "day";
  const horizonDays =
    granularity === "hour" ? getMaxLogDays() : getMaxStatsDays();
  const horizon = new Date(now.getTime() - horizonDays * MS_PER_DAY);
  const clamped: TimeRange = {
    from: ordered.from < horizon ? horizon : ordered.from,
    to: ordered.to,
  };
  return {
    ...clamped,
    granularity,
    previous:
      query.comparison === NO_COMPARISON ? null : previousRange(clamped),
  };
}

function previousRange(range: TimeRange): TimeRange {
  const span = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - span), to: range.from };
}

/** Bucket start times covering `range`, oldest first. */
export function bucketStarts(
  range: TimeRange,
  granularity: WindowGranularity,
): number[] {
  const starts: number[] = [];
  const cursor = new Date(range.from);
  if (granularity === "hour") {
    cursor.setMinutes(0, 0, 0);
  } else {
    cursor.setHours(0, 0, 0, 0);
  }
  while (cursor.getTime() <= range.to.getTime()) {
    starts.push(cursor.getTime());
    if (granularity === "hour") {
      cursor.setTime(cursor.getTime() + MS_PER_HOUR);
    } else {
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return starts;
}

/** Start of the bucket `timestamp` falls in. */
export function bucketOf(
  timestamp: number,
  granularity: WindowGranularity,
): number {
  const date = new Date(timestamp);
  if (granularity === "hour") {
    date.setMinutes(0, 0, 0);
  } else {
    date.setHours(0, 0, 0, 0);
  }
  return date.getTime();
}
