import type { RouteStatisticsModel } from "@/db";
import {
  type ChartDataPoint,
  type ChartResponse,
  type DayStatistics,
  MAX_CHART_BUCKETS,
  STATISTICS_CHART_DAYS,
} from "@/types";
import { combineAggregate } from "./statistics-aggregate";
import { buildDayStatsMap, getDayBuckets } from "./statistics-utils";

/** Extracts chart data points from the day statistics of one bucket */
type StatsExtractor = (
  stats: DayStatistics[],
  label: string,
) => ChartDataPoint[];

/**
 * Build chart data from statistics using an extractor function
 *
 * Days are grouped into at most MAX_CHART_BUCKETS points, so a long window
 * widens each bucket instead of crowding the chart. Buckets with no traffic
 * still emit a zero point — no gaps.
 */
function buildChartData(
  stats: DayStatistics[],
  extractor: StatsExtractor,
  days: number,
): ChartDataPoint[] {
  const statsMap = buildDayStatsMap(stats);

  return getDayBuckets(days, MAX_CHART_BUCKETS).flatMap(
    ({ timestamps, label }) => {
      const bucketStats = timestamps
        .map((timestamp) => statsMap.get(timestamp))
        .filter((stat): stat is DayStatistics => stat !== undefined);
      return extractor(bucketStats, label);
    },
  );
}

/**
 * Extract request count data points (success, client error, server error).
 * Counts are additive, so a bucket totals its days — getDayBuckets keeps every
 * bucket the same width so those totals stay comparable.
 */
const countExtractor: StatsExtractor = (stats, label) => {
  const { count, errClient, errServer } = combineAggregate(stats);

  return [
    { x: label, y: count - errClient - errServer, label, category: "Success" },
    { x: label, y: errClient, label, category: "Client Error" },
    { x: label, y: errServer, label, category: "Server Error" },
  ];
};

/**
 * Extract response time data points (average, min, max).
 *
 * Latency does not add up, so a bucket takes the true extremes of its days and
 * an average weighted by request count — averaging the per-day averages would
 * let a quiet day weigh as much as a busy one.
 */
const timesExtractor: StatsExtractor = (stats, label) => {
  const { count, totalLatency, min, max } = combineAggregate(stats);

  return [
    {
      x: label,
      y: count > 0 ? totalLatency / count : 0,
      label,
      category: "Average",
    },
    { x: label, y: min, label, category: "Min" },
    { x: label, y: max, label, category: "Max" },
  ];
};

/**
 * Get route statistics for request counts chart
 */
export async function getRouteStatistics(
  model: RouteStatisticsModel,
  method: string,
  uri: string,
  days: number = STATISTICS_CHART_DAYS,
): Promise<ChartResponse> {
  const route = await model.getByRoute(method, uri);
  const stats = route?.statistics ?? [];
  return { data: buildChartData(stats, countExtractor, days) };
}

/**
 * Get route statistics for response times chart
 */
export async function getResponseTimesStatistics(
  model: RouteStatisticsModel,
  method: string,
  uri: string,
  days: number = STATISTICS_CHART_DAYS,
): Promise<ChartResponse> {
  const route = await model.getByRoute(method, uri);
  const stats = route?.statistics ?? [];
  return { data: buildChartData(stats, timesExtractor, days) };
}
