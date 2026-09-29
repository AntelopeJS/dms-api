import { getConfig } from "@/config";
import type { RouteStatistics } from "@/db/tables/routes_statistics.table";
import type { DayStatistics } from "@/types";
import { getTodayTimestamp } from "./statistics-utils";
import {
  MAX_STATISTICS_WRITE_ATTEMPTS,
  type RouteStatisticsStore,
  statisticsRetryDelay,
} from "./statistics-write";

function pruneOldStats(
  statistics: DayStatistics[],
  cutoff: number,
): DayStatistics[] {
  return statistics.filter((stat) => stat.day >= cutoff);
}

/**
 * Drop expired days from one route's rollup. The write is guarded by the row
 * revision like the per-request writer, so a request recorded between the
 * read and the write is not erased; on conflict the row is re-read and pruned
 * again. Returns whether a pruned array was written.
 */
async function pruneRouteStats(
  statsModel: RouteStatisticsStore,
  initial: RouteStatistics,
  cutoff: number,
): Promise<boolean> {
  let routeStats: RouteStatistics | undefined = initial;
  for (let attempt = 0; attempt < MAX_STATISTICS_WRITE_ATTEMPTS; attempt++) {
    if (!routeStats) return false;
    const pruned = pruneOldStats(routeStats.statistics, cutoff);
    if (pruned.length === routeStats.statistics.length) return false;
    routeStats.statistics = pruned;
    const outcome = await statsModel.replaceStatistics(routeStats);
    if (outcome !== "not-applied") return outcome === "applied";
    await statisticsRetryDelay(attempt + 1);
    routeStats = await statsModel.get(routeStats._id);
  }
  return false;
}

/**
 * Prune day-stats older than the configured retention window. Retention is
 * the effective `statisticsLifetime` from `getConfig()`: module config
 * overlaid with the runtime overrides persisted by the Settings page.
 */
export async function pruneAllStatistics(
  statsModel: RouteStatisticsStore,
): Promise<number> {
  const { statisticsLifetime } = getConfig();
  const today = getTodayTimestamp();
  const cutoff = today - statisticsLifetime;

  const allStats = await statsModel.getAll();
  let prunedCount = 0;

  for (const routeStats of allStats) {
    if (await pruneRouteStats(statsModel, routeStats, cutoff)) {
      prunedCount++;
    }
  }

  return prunedCount;
}
