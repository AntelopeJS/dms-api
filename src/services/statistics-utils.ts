import type { DayStatistics } from "@/types";

/**
 * Get today's timestamp at midnight (ms since epoch)
 */
export function getTodayTimestamp(): number {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Get the midnight timestamp (ms since epoch) opening a last-N-days window,
 * i.e. midnight of N-1 days ago — same wall-clock walk as getDayInfo so
 * window membership and chart buckets agree across DST transitions.
 */
export function getWindowStartTimestamp(days: number): number {
  const date = new Date();
  date.setDate(date.getDate() - (days - 1));
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Pre-compute timestamps and labels for the last N days
 * Returns array from oldest to newest: [N-1 days ago, ..., today]
 *
 * Label style depends on window length: short weekday for ≤7 days,
 * "MMM D" for longer windows so 30-day charts don't collapse to
 * 7 repeated weekday tickmarks, and "MMM D, YYYY" past a year, where
 * "MMM D" would repeat and collide — consumers key chart points by label.
 */
export interface DayInfo {
  timestamp: number;
  label: string;
}

export function getDayInfo(days: number): DayInfo[] {
  const result: DayInfo[] = [];
  const now = new Date();
  const formatOptions: Intl.DateTimeFormatOptions = labelFormat(days);

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);

    result.push({
      timestamp: date.getTime(),
      label: date.toLocaleDateString("en-US", formatOptions),
    });
  }

  return result;
}

/** A run of consecutive days plotted as a single chart point */
export interface DayBucket {
  /** Midnight timestamps covered, oldest to newest */
  timestamps: number[];
  label: string;
}

/**
 * Bucket widths tried in order, in days. Snapping to these rather than dividing
 * days by maxBuckets keeps a run a round number of days — a 90-day window plots
 * 7-day runs instead of 6.43-day ones. Runs are anchored on today, so they are
 * not calendar weeks. Sizes above 7 are omitted because parsePeriodDays caps a
 * window at 90 days, where 7 already fits under the bucket cap.
 */
const NICE_BUCKET_SIZES = [1, 2, 3, 7];

function pickBucketSize(days: number, maxBuckets: number): number {
  // floor, not ceil: getDayBuckets drops the leftover days rather than plotting
  // them, so it emits floor(days / size) buckets. Rounding up would reject a
  // width whose real bucket count fits, picking a needlessly coarse chart.
  const size = NICE_BUCKET_SIZES.find(
    (candidate) => Math.floor(days / candidate) <= maxBuckets,
  );
  // Only reachable if the period cap ever rises past ~104 days; keeps the
  // function total rather than returning undefined.
  return size ?? Math.ceil(days / maxBuckets);
}

/**
 * Split the last N days into at most maxBuckets plot points.
 *
 * Buckets are filled from today backwards, so the newest one always ends on
 * today. Every bucket spans exactly `size` days: the counts chart sums each
 * bucket, so a short one would plot as a traffic drop that never happened.
 * When the size does not divide the window, the leftover oldest days are
 * dropped rather than plotted as an under-reporting bucket — at most size-1
 * days, and never for the 1d/7d/30d the UI offers, which all divide evenly.
 *
 * Below the cap each day keeps its own bucket and this is a pass-through of
 * getDayInfo.
 */
export function getDayBuckets(days: number, maxBuckets: number): DayBucket[] {
  const dayInfo = getDayInfo(days);
  const size = pickBucketSize(days, maxBuckets);
  const buckets: DayBucket[] = [];
  const leftover = dayInfo.length % size;

  for (let end = dayInfo.length; end - size >= leftover; end -= size) {
    const run = dayInfo.slice(end - size, end);
    const first = run[0];
    const last = run[run.length - 1];

    buckets.push({
      timestamps: run.map((day) => day.timestamp),
      label: run.length === 1 ? first.label : `${first.label} – ${last.label}`,
    });
  }

  return buckets.reverse();
}

/**
 * A window longer than a year revisits the same "MMM D" twice, so the year
 * has to be part of the label. 365 days is still safe: the window opens the
 * day after the same date one year back.
 */
function labelFormat(days: number): Intl.DateTimeFormatOptions {
  if (days <= 7) return { weekday: "short" };
  if (days > 365) return { year: "numeric", month: "short", day: "numeric" };
  return { month: "short", day: "numeric" };
}

/**
 * Build a Map from day statistics for O(1) lookup by timestamp
 */
export function buildDayStatsMap(
  stats: DayStatistics[],
): Map<number, DayStatistics> {
  return new Map(stats.map((stat) => [stat.day, stat]));
}
