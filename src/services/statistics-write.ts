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

/**
 * Add statistics for a request
 * Uses composite key for O(1) lookup
 * Handles race conditions with retry on duplicate key
 */
export async function addRequestStatistics(
  model: RouteStatisticsModel,
  request: RequestStatistics,
): Promise<void> {
  const id = getRouteStatsKey(request.method, request.uri);
  const today = getTodayTimestamp();

  // Try to get existing document first (most common case)
  const existing = await model.get(id);

  if (existing) {
    updateRouteStats(existing, request, today);
    await model.update(existing);
    return;
  }

  // Document doesn't exist, try to insert
  try {
    await model.insert({
      _id: id,
      method: request.method.toUpperCase(),
      uri: request.uri,
      statistics: [createDayStats(request, today)],
    } as RouteStatistics);
  } catch (error) {
    // Race condition: document was created between get and insert
    if (isDuplicateKeyError(error)) {
      const nowExisting = await model.get(id);
      if (nowExisting) {
        updateRouteStats(nowExisting, request, today);
        await model.update(nowExisting);
      }
    } else {
      throw error;
    }
  }
}
