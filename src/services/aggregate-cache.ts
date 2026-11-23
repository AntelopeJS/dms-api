import { createMemoPool, type Memo } from "@/memo";

/** How long a cached aggregation is served, by default. */
export const CACHE_TTL_MS = 15_000;

/** Bound on the entries kept: each can hold a day of samples. */
const MAX_ENTRIES = 24;

const aggregates = createMemoPool(MAX_ENTRIES, CACHE_TTL_MS);

/**
 * The memo of one aggregation, sharing the bound of all the others. The
 * memos are short-lived and shared by the monitoring pages: a page loads its
 * blocks at once, the first one starts the scan and the others wait for the
 * same promise, then read the result until it expires.
 *
 * Keys name what was computed and over which range; the ranges themselves are
 * pinned to a clock that ticks every {@link CACHE_QUANTUM_MS} (see
 * `window.ts`), so the blocks of one page land on the same keys.
 */
export function aggregateMemo<T>(): Memo<T> {
  return aggregates.memo<T>();
}

/** Forget everything: for tests, and after a setting changes what counts. */
export function clearAggregateCache(): void {
  aggregates.clear();
}
