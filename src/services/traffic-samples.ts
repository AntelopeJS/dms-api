import type { RequestLogModel } from "@/db";
import type {
  RequestLogFilters,
  RequestLogSample,
} from "@/db/models/request_log.model";
import { MS_PER_DAY } from "@/types";
import { cached } from "./aggregate-cache";
import { scopeRouteKey } from "./scope";
import { CACHE_QUANTUM_MS, pinnedNow, type TimeRange } from "./window";

/**
 * The logged requests the traffic aggregates are built from: one scan of the
 * last day shared by every reader, and rolling scans extended by their new
 * rows rather than read again on each live tick.
 */

/** What the traffic reads of the logs: the reduced rows of a range. */
export type SampleSource = Pick<RequestLogModel, "samples">;

/** Route scope: `METHOD:uri` keys, or null for every route. */
export type ScopeKeys = Set<string> | null;

function inScope(keys: ScopeKeys, method: string, uri: string): boolean {
  return !keys || keys.has(scopeRouteKey(method, uri));
}

// ---------------------------------------------------------------------------
// Logged requests
// ---------------------------------------------------------------------------

/**
 * Health, "Needs attention", the routes tree and the 24h charts all read the
 * last day of requests: it is loaded once and the others slice it.
 */
export const RECENT_SPAN_MS = MS_PER_DAY;

/** Samples sorted by time, with their timestamps for a binary search. */
interface SampleSet {
  samples: RequestLogSample[];
  times: number[];
}

export function timeOf(sample: RequestLogSample): number {
  return new Date(sample.timestamp).getTime();
}

/** `[range.from, range.to)` of the logs, by one scan, sorted by time. */
export async function scanSamples(
  model: SampleSource,
  range: TimeRange,
  filters: RequestLogFilters = {},
): Promise<SampleSet> {
  const to = range.to.getTime();
  const rows = await model.samples({
    ...filters,
    since: range.from,
    until: range.to,
  });
  const samples = rows
    .filter((sample) => timeOf(sample) < to)
    .sort((a, b) => timeOf(a) - timeOf(b));
  return { samples, times: samples.map(timeOf) };
}

/** First index of `times` at or after `at`. */
function lowerBound(times: number[], at: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (times[middle] < at) low = middle + 1;
    else high = middle;
  }
  return low;
}

function slice(set: SampleSet, range: TimeRange): RequestLogSample[] {
  return set.samples.slice(
    lowerBound(set.times, range.from.getTime()),
    lowerBound(set.times, range.to.getTime()),
  );
}

export function rangeKey(range: TimeRange): string {
  return `${range.from.getTime()}:${range.to.getTime()}`;
}

/**
 * The end of the last day scanned is read again on the next scan: a request
 * is stored a moment after its timestamp, so the rows just before the end of
 * a scan may land after it.
 */
const RESCAN_TAIL_MS = 30_000;

/** A rolling range last scanned, what the next scan of it extends. */
interface RollingScan {
  model: SampleSource;
  from: number;
  to: number;
  set: SampleSet;
}

/**
 * The rows of `range` under `filters`, from the `previous` scan of the same
 * rolling range when it holds its start: its clock moves every few seconds
 * and a page in live mode asks again as often, so rather than reading the
 * whole range again, the previous one is kept, its start trimmed, and only
 * its last {@link RESCAN_TAIL_MS} and what came after are read.
 */
async function extendScan(
  previous: RollingScan | undefined,
  model: SampleSource,
  range: TimeRange,
  filters: RequestLogFilters = {},
): Promise<SampleSet> {
  const from = range.from.getTime();
  if (
    !previous ||
    previous.model !== model ||
    previous.from > from ||
    previous.to > range.to.getTime() ||
    previous.to - RESCAN_TAIL_MS <= from
  ) {
    return scanSamples(model, range, filters);
  }
  const tail = previous.to - RESCAN_TAIL_MS;
  const kept = slice(previous.set, { from: range.from, to: new Date(tail) });
  const fresh = await scanSamples(
    model,
    { from: new Date(tail), to: range.to },
    filters,
  );
  const samples = kept.concat(fresh.samples);
  return { samples, times: samples.map(timeOf) };
}

/** Keeps `scan` under `key` unless a later one of the same range is there. */
function keepScan(
  scans: Map<string, RollingScan>,
  key: string,
  scan: RollingScan,
): void {
  const kept = scans.get(key);
  if (!kept || kept.to <= scan.to) scans.set(key, scan);
}

/** The rolling ranges last scanned: the last day, and the errors' windows. */
const rollingScans = new Map<string, RollingScan>();

const RECENT_SCAN = "recent";

/** The requests of the last day ending at `recent.to`, extending the last scan. */
async function scanRecent(
  model: SampleSource,
  recent: TimeRange,
): Promise<SampleSet> {
  const set = await extendScan(rollingScans.get(RECENT_SCAN), model, recent);
  keepScan(rollingScans, RECENT_SCAN, {
    model,
    from: recent.from.getTime(),
    to: recent.to.getTime(),
    set,
  });
  return set;
}

/** Forget the rolling ranges scanned: for tests, with the aggregate cache. */
export function forgetRecentScan(): void {
  rollingScans.clear();
}

/**
 * Every logged request of `range`, every route, sorted by time. A range
 * inside the last day is sliced out of the shared recent scan; any other is
 * scanned once and cached under its bounds.
 */
export async function samplesIn(
  model: SampleSource,
  range: TimeRange,
): Promise<RequestLogSample[]> {
  const now = pinnedNow();
  const recent: TimeRange = {
    from: new Date(now.getTime() - RECENT_SPAN_MS),
    to: now,
  };
  // A caller with its own clock asks up to a few seconds past the pinned
  // "now": those requests are left for the next tick.
  if (
    range.from >= recent.from &&
    range.to.getTime() <= now.getTime() + CACHE_QUANTUM_MS
  ) {
    const set = await cached(`samples:${rangeKey(recent)}`, () =>
      scanRecent(model, recent),
    );
    return slice(set, range);
  }
  const set = await cached(`samples:${rangeKey(range)}`, () =>
    scanSamples(model, range),
  );
  return slice(set, range);
}

/** Logged requests in scope over `range`, reduced to what aggregations read. */
export async function loadSamples(
  model: SampleSource,
  range: TimeRange,
  keys: ScopeKeys,
): Promise<RequestLogSample[]> {
  if (keys && keys.size === 0) return [];
  const samples = await samplesIn(model, range);
  return keys
    ? samples.filter((sample) => inScope(keys, sample.method, sample.uri))
    : samples;
}

/**
 * The rows of `range` answered with at least `minStatus`; a rolling range
 * (ending now) extends the last scan of the same length.
 */
async function scanErrors(
  model: SampleSource,
  range: TimeRange,
  minStatus: 400 | 500,
): Promise<SampleSet> {
  const filters = { statusMin: minStatus };
  const to = range.to.getTime();
  if (to < pinnedNow().getTime() - CACHE_QUANTUM_MS)
    return scanSamples(model, range, filters);
  const key = `errors:${minStatus}:${to - range.from.getTime()}`;
  const set = await extendScan(rollingScans.get(key), model, range, filters);
  keepScan(rollingScans, key, {
    model,
    from: range.from.getTime(),
    to,
    set,
  });
  return set;
}

/**
 * Logged requests of `range` answered with at least `minStatus`: what error
 * groups and incidents read, far fewer rows than the whole traffic over a
 * week. Still, the logs keep no index on the status: finding them reads the
 * whole range. A range ending now (the activity journal, read every few
 * seconds in live mode) extends its last scan instead, by its new rows.
 */
export async function loadErrorSamples(
  model: SampleSource,
  range: TimeRange,
  keys: ScopeKeys,
  minStatus: 400 | 500,
): Promise<RequestLogSample[]> {
  if (keys && keys.size === 0) return [];
  const set = await cached(`errors:${minStatus}:${rangeKey(range)}`, () =>
    scanErrors(model, range, minStatus),
  );
  const samples = slice(set, range);
  return keys
    ? samples.filter((sample) => inScope(keys, sample.method, sample.uri))
    : samples;
}
