/**
 * A short-lived memo for the aggregations the monitoring pages share. A page
 * loads its blocks at once and each block used to rescan the same logs; here
 * the first one starts the scan and the others wait for the same promise,
 * then read the result until it expires.
 *
 * Keys name what was computed and over which range; the ranges themselves are
 * pinned to a clock that ticks every {@link CACHE_QUANTUM_MS} (see
 * `window.ts`), so the blocks of one page land on the same keys.
 */

import { createMemo } from "@/memo";

/** How long a cached aggregation is served, by default. */
export const CACHE_TTL_MS = 15_000;

/** Bound on the entries kept: each can hold a day of samples. */
const MAX_ENTRIES = 24;

const aggregates = createMemo(MAX_ENTRIES, CACHE_TTL_MS);

/** The shared aggregation under `key` (see `Memo.cached`). */
export function cached<T>(
  key: string,
  load: () => Promise<T>,
  ttlMs: number = CACHE_TTL_MS,
): Promise<T> {
  return aggregates.cached(key, load, ttlMs);
}

/** Forget everything: for tests, and after a setting changes what counts. */
export function clearAggregateCache(): void {
  aggregates.clear();
}
