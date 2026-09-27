import { randomUUID } from "node:crypto";
import type { RouteStatisticsModel } from "@/db";
import {
  getRouteStatsKey,
  type RouteStatistics,
} from "@/db/tables/routes_statistics.table";
import type { DayStatistics, RequestStatistics } from "@/types";
import { getTodayTimestamp } from "./statistics-utils";

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
  return {
    day: today,
    requestsCount: 1,
    averageResponseTime: request.responseTime,
    minResponseTime: request.responseTime,
    maxResponseTime: request.responseTime,
    totalResponseTime: request.responseTime,
    clientErrorsCount: isClientError(request.statusCode) ? 1 : 0,
    serverErrorsCount: isServerError(request.statusCode) ? 1 : 0,
  };
}

/**
 * Update existing day statistics with a new request
 */
function mergeDayStats(
  existing: DayStatistics,
  request: RequestStatistics,
): void {
  existing.requestsCount++;
  existing.totalResponseTime += request.responseTime;
  existing.averageResponseTime =
    existing.totalResponseTime / existing.requestsCount;
  existing.minResponseTime = Math.min(
    existing.minResponseTime,
    request.responseTime,
  );
  existing.maxResponseTime = Math.max(
    existing.maxResponseTime,
    request.responseTime,
  );

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
  request: RequestStatistics,
  today: number,
): Promise<boolean> {
  try {
    await model.insert({
      _id: id,
      method: request.method.toUpperCase(),
      uri: request.uri,
      statistics: [createDayStats(request, today)],
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
 * Add statistics for a request
 * Uses composite key for O(1) lookup
 *
 * The day rollup is a read-modify-write of the whole `statistics` array, so
 * the write is guarded by the row revision and retried from a fresh read when
 * another request got there first. An "unknown" outcome (the write may or may
 * not have landed) ends the attempt: undercounting one request beats counting
 * it twice.
 */
export async function addRequestStatistics(
  model: RouteStatisticsStore,
  request: RequestStatistics,
): Promise<void> {
  const id = getRouteStatsKey(request.method, request.uri);
  const today = getTodayTimestamp();

  for (let attempt = 0; attempt < MAX_STATISTICS_WRITE_ATTEMPTS; attempt++) {
    if (attempt > 0) await statisticsRetryDelay(attempt);
    const existing = await model.get(id);
    if (!existing) {
      if (await insertRouteStats(model, id, request, today)) return;
      continue;
    }
    updateRouteStats(existing, request, today);
    const outcome = await model.replaceStatistics(existing);
    if (outcome !== "not-applied") return;
  }
  throw new Error(
    `Route statistics for ${id} kept changing concurrently; request not recorded`,
  );
}
