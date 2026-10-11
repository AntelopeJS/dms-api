import { randomUUID } from "node:crypto";
import type { RouteStatisticsModel } from "@/db";
import {
  getRouteStatsKey,
  type RouteStatistics,
} from "@/db/tables/routes_statistics.table";
import type { DayStatistics, RequestStatistics } from "@/types";
import {
  emptyHistogram,
  getTodayTimestamp,
  latencyBucketIndex,
} from "./statistics-utils";

/**
 * Check if request is a client error (4xx)
 */
function isClientError(statusCode: number): boolean {
  return statusCode >= 400 && statusCode < 500;
}

/**
 * Check if request is a server error (5xx)
 */
function isServerError(statusCode: number): boolean {
  return statusCode >= 500;
}

/**
 * Create initial statistics for a new day
 */
function createDayStats(
  request: RequestStatistics,
  today: number,
): DayStatistics {
  const stats: DayStatistics = {
    day: today,
    requestsCount: 0,
    averageResponseTime: 0,
    minResponseTime: 0,
    maxResponseTime: 0,
    totalResponseTime: 0,
    clientErrorsCount: 0,
    serverErrorsCount: 0,
    timedRequestsCount: 0,
    latencyHistogram: emptyHistogram(),
  };
  mergeDayStats(stats, request);
  return stats;
}

/**
 * Fold a measured duration into the day's latency figures. A day written
 * before the histogram existed keeps none: half a day of counts would
 * misstate its p95.
 */
function addTiming(existing: DayStatistics, ms: number): void {
  const timed = existing.timedRequestsCount ?? existing.requestsCount;
  existing.minResponseTime =
    timed === 0 ? ms : Math.min(existing.minResponseTime, ms);
  existing.maxResponseTime = Math.max(existing.maxResponseTime, ms);
  existing.totalResponseTime += ms;
  existing.timedRequestsCount = timed + 1;
  existing.averageResponseTime =
    existing.totalResponseTime / existing.timedRequestsCount;
  if (existing.latencyHistogram) {
    existing.latencyHistogram[latencyBucketIndex(ms)] += 1;
  }
}

/**
 * Update existing day statistics with a new request. A call whose duration
 * was not measured counts as a call, never as a 0 ms one.
 */
function mergeDayStats(
  existing: DayStatistics,
  request: RequestStatistics,
): void {
  if (typeof request.responseTime === "number") {
    addTiming(existing, request.responseTime);
  } else {
    existing.timedRequestsCount ??= existing.requestsCount;
  }
  existing.requestsCount++;

  if (isClientError(request.statusCode)) {
    existing.clientErrorsCount++;
  } else if (isServerError(request.statusCode)) {
    existing.serverErrorsCount++;
  }
}

/**
 * Check if error is a duplicate key error
 */
function isDuplicateKeyError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.message.includes("duplicate key") ||
      error.message.includes("E11000")
    );
  }
  return false;
}

/**
 * Update existing route statistics with a new request
 */
function updateRouteStats(
  existing: RouteStatistics,
  request: RequestStatistics,
  today: number,
): void {
  const dayStats = existing.statistics.find((s) => s.day === today);

  if (dayStats) {
    mergeDayStats(dayStats, request);
  } else {
    existing.statistics.push(createDayStats(request, today));
  }
}

/** The table operations the guarded rollup writers rely on. */
export type RouteStatisticsStore = Pick<
  RouteStatisticsModel,
  "get" | "getAll" | "insert" | "replaceStatistics"
>;

/**
 * Upper bound on read-modify-write attempts for one request. Each retry means
 * another writer landed in between; past this many, the request is dropped
 * from the rollup rather than retried forever against a hot route.
 */
export const MAX_STATISTICS_WRITE_ATTEMPTS = 10;

const RETRY_BASE_DELAY_MS = 2;
const RETRY_MAX_DELAY_MS = 250;

/**
 * Randomized, growing pause before a retry. A burst of requests on one route
 * reads the same revision at once; without jitter they would retry in lockstep
 * and only one would win per round.
 */
export function statisticsRetryDelay(attempt: number): Promise<void> {
  const ceiling = Math.min(
    RETRY_MAX_DELAY_MS,
    RETRY_BASE_DELAY_MS * 2 ** attempt,
  );
  return new Promise((resolve) => setTimeout(resolve, Math.random() * ceiling));
}

async function insertRouteStats(
  model: RouteStatisticsStore,
  id: string,
  requests: RequestStatistics[],
  today: number,
): Promise<boolean> {
  const [first, ...rest] = requests;
  const day = createDayStats(first, today);
  for (const request of rest) mergeDayStats(day, request);
  try {
    await model.insert({
      _id: id,
      method: first.method.toUpperCase(),
      uri: first.uri,
      statistics: [day],
      revision: randomUUID(),
    } as RouteStatistics);
    return true;
  } catch (error) {
    // Race condition: document was created between get and insert
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
}

/**
 * Fold `requests` into the route's rollup: a read-modify-write of the whole
 * `statistics` array, guarded by the row revision and retried from a fresh
 * read when another writer (another instance, the prune) got there first. An
 * "unknown" outcome (the write may or may not have landed) ends the attempt:
 * undercounting beats counting twice.
 */
async function writeRequestStatistics(
  model: RouteStatisticsStore,
  id: string,
  requests: RequestStatistics[],
): Promise<void> {
  const today = getTodayTimestamp();
  for (let attempt = 0; attempt < MAX_STATISTICS_WRITE_ATTEMPTS; attempt++) {
    if (attempt > 0) await statisticsRetryDelay(attempt);
    const existing = await model.get(id);
    if (!existing) {
      if (await insertRouteStats(model, id, requests, today)) return;
      continue;
    }
    for (const request of requests) updateRouteStats(existing, request, today);
    const outcome = await model.replaceStatistics(existing);
    if (outcome !== "not-applied") return;
  }
  throw new Error(
    `Route statistics for ${id} kept changing concurrently; ${requests.length} request(s) not recorded`,
  );
}

/** Requests of a route waiting for the write after the one in flight. */
interface PendingBatch {
  requests: RequestStatistics[];
  written: Promise<void>;
}

/** Per route key: the batch still open to new requests. */
const openBatches = new Map<string, PendingBatch>();
/** Per route key: the last write queued, settled or not. */
const lastWrites = new Map<string, Promise<void>>();

/**
 * Add statistics for a request
 * Uses composite key for O(1) lookup
 *
 * The writes of one route never race each other in this process: a request
 * arriving while its route's rollup is being written joins the next write,
 * which folds every request gathered meanwhile in one read-modify-write. A
 * burst on a hot route costs a few writes instead of one conflicting attempt
 * per request, which could exhaust their retries and drop requests. The
 * revision guard still settles the races with other instances and the prune.
 */
export function addRequestStatistics(
  model: RouteStatisticsStore,
  request: RequestStatistics,
): Promise<void> {
  const id = getRouteStatsKey(request.method, request.uri);
  const open = openBatches.get(id);
  if (open) {
    open.requests.push(request);
    return open.written;
  }
  const requests = [request];
  const previous = lastWrites.get(id) ?? Promise.resolve();
  const written = previous.then(() => {
    // Closed as its write starts: later requests open the next batch.
    openBatches.delete(id);
    return writeRequestStatistics(model, id, requests);
  });
  openBatches.set(id, { requests, written });
  const settled = written.then(
    () => undefined,
    () => undefined,
  );
  lastWrites.set(id, settled);
  void settled.then(() => {
    if (lastWrites.get(id) === settled) lastWrites.delete(id);
  });
  return written;
}
