import { getConfig } from "@/config";
import type { RouteStatisticsModel } from "@/db";
import type { DayStatistics } from "@/types";
import { getTodayTimestamp } from "./statistics-utils";

function pruneOldStats(
  statistics: DayStatistics[],
  cutoff: number,
): DayStatistics[] {
  return statistics.filter((stat) => stat.day >= cutoff);
}

/**
 * Prune day-stats older than the configured retention window. Retention is
 * the effective `statisticsLifetime` from `getConfig()`: module config
 * overlaid with the runtime overrides persisted by the Settings page.
 */
export async function pruneAllStatistics(
  statsModel: RouteStatisticsModel,
): Promise<number> {
  const { statisticsLifetime } = getConfig();
  const today = getTodayTimestamp();
  const cutoff = today - statisticsLifetime;

  const allStats = await statsModel.getAll();
  let prunedCount = 0;

  for (const routeStats of allStats) {
    const originalLength = routeStats.statistics.length;
    routeStats.statistics = pruneOldStats(routeStats.statistics, cutoff);

    if (routeStats.statistics.length < originalLength) {
      await statsModel.update(routeStats);
      prunedCount++;
    }
  }

  return prunedCount;
}
