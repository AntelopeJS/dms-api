import { LATENCY_BUCKETS_MS } from "@/types";

/**
 * Get today's timestamp at midnight (ms since epoch)
 */
export function getTodayTimestamp(): number {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** An empty latency histogram, one count per bucket of `LATENCY_BUCKETS_MS`. */
export function emptyHistogram(): number[] {
  return Array.from({ length: LATENCY_BUCKETS_MS.length + 1 }, () => 0);
}

/** Index of the histogram bucket a duration of `ms` falls in. */
export function latencyBucketIndex(ms: number): number {
  const index = LATENCY_BUCKETS_MS.findIndex((bound) => ms < bound);
  return index < 0 ? LATENCY_BUCKETS_MS.length : index;
}

/** The measured extremes of the durations a histogram counts. */
export interface LatencyRange {
  min: number;
  max: number;
}

/**
 * The `quantile` (0-1) of the durations a histogram counts, interpolated
 * linearly inside the bucket it lands in. With the measured `range`, the
 * bucket is narrowed to it (the open last bucket ends at the max) and the
 * answer never leaves it; without, the open last bucket answers its lower
 * bound. Null for an empty histogram.
 */
export function histogramQuantile(
  histogram: number[],
  quantile: number,
  range?: LatencyRange,
): number | null {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  const clamp = (value: number) =>
    range ? Math.min(range.max, Math.max(range.min, value)) : value;
  const rank = quantile * total;
  let seen = 0;
  for (let index = 0; index < histogram.length; index++) {
    const count = histogram[index];
    if (count === 0 || seen + count < rank) {
      seen += count;
      continue;
    }
    const lower = clamp(index === 0 ? 0 : LATENCY_BUCKETS_MS[index - 1]);
    const isOpen = index === LATENCY_BUCKETS_MS.length;
    if (isOpen && !range) return lower;
    const upper = clamp(isOpen ? Infinity : LATENCY_BUCKETS_MS[index]);
    return lower + ((rank - seen) / count) * (upper - lower);
  }
  return clamp(LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1]);
}

/** The `quantile` (0-1) of `values`, by nearest rank. Null when empty. */
export function exactQuantile(
  values: number[],
  quantile: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(quantile * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}
