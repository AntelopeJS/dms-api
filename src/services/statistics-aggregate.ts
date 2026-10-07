import { getConfig } from "@/config";
import type { RouteStatisticsModel } from "@/db";
import type { RouteStatistics } from "@/db/tables/routes_statistics.table";
import type { DayStatistics } from "@/types";
import { ELEVATED_ERROR_RATE, MS_PER_DAY } from "@/types";
import { getTodayTimestamp } from "./statistics-utils";

/**
 * Aggregated readers used by the Summary and Monitoring pages.
 *
 * Most readers are pure computations over `RouteStatistics` day rollups;
 * the sub-day history readers ({@link getRequestHistoryHourly} /
 * {@link getRequestHistoryMinutely}) additionally scan `RequestLog`
 * through {@link bucketHistoryFromLogs}.
 */

export interface SummaryKpis {
  totalRoutes: number;
  routesWithErrors24h: number;
  slowRoutesCount: number;
  averageLatencyMs: number;
  callsToday: number;
  errors24h: number;
}

export interface WatchListItem {
  routeKey: string;
  method: string;
  uri: string;
  errorRate: number;
  averageLatencyMs: number;
  requestsLast24h: number;
  flag: "broken" | "slow" | "warn";
}

/**
 * Total request counts split by HTTP status class, for the donut on the
 * Overview page. `success` is every non-error request (2xx/3xx); the two
 * error buckets mirror the day-statistics counters.
 */
export interface StatusBreakdown {
  success: number;
  clientErrors: number;
  serverErrors: number;
  total: number;
}

/**
 * Scope filter shared by every reader: a Set of `METHOD:uri` keys (from
 * {@link getScopedRouteKeys}) restricts the aggregation to those routes;
 * null/undefined means no filtering (scope "all").
 */
type ScopeKeys = Set<string> | null | undefined;

function scopedStats(
  all: RouteStatistics[],
  keys: ScopeKeys,
): RouteStatistics[] {
  if (!keys) return all;
  return all.filter((route) => keys.has(routeKey(route)));
}

function sumDay(stat: DayStatistics): number {
  return stat.requestsCount;
}

function totalErrors(stat: DayStatistics): number {
  return stat.clientErrorsCount + stat.serverErrorsCount;
}

function isSlow(stat: DayStatistics, threshold: number): boolean {
  return stat.maxResponseTime >= threshold;
}

function lastNDays(stats: DayStatistics[], n: number): DayStatistics[] {
  const today = getTodayTimestamp();
  const cutoff = today - (n - 1) * MS_PER_DAY;
  return stats.filter((s) => s.day >= cutoff);
}

export function combineAggregate(stats: DayStatistics[]): {
  count: number;
  totalLatency: number;
  min: number;
  max: number;
  errClient: number;
  errServer: number;
} {
  let count = 0;
  let totalLatency = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  let errClient = 0;
  let errServer = 0;
  for (const s of stats) {
    count += s.requestsCount;
    totalLatency += s.totalResponseTime;
    if (s.minResponseTime < min) min = s.minResponseTime;
    if (s.maxResponseTime > max) max = s.maxResponseTime;
    errClient += s.clientErrorsCount;
    errServer += s.serverErrorsCount;
  }
  return {
    count,
    totalLatency,
    min: min === Number.POSITIVE_INFINITY ? 0 : min,
    max,
    errClient,
    errServer,
  };
}

interface KpiTotals {
  routesWithErrors24h: number;
  slowRoutesCount: number;
  totalLatency: number;
  totalRequests: number;
  callsToday: number;
  errors24h: number;
}

function accumulateRouteKpis(
  route: RouteStatistics,
  today: number,
  last24hCutoff: number,
  slowThreshold: number,
): KpiTotals {
  const recent = route.statistics.filter((s) => s.day >= last24hCutoff);
  let totalRequests = 0;
  let totalLatency = 0;
  for (const s of route.statistics) {
    totalRequests += s.requestsCount;
    totalLatency += s.totalResponseTime;
  }
  let errors24h = 0;
  for (const s of recent) errors24h += totalErrors(s);
  const todayStat = route.statistics.find((s) => s.day === today);
  return {
    routesWithErrors24h: recent.some((s) => totalErrors(s) > 0) ? 1 : 0,
    slowRoutesCount: route.statistics.some((s) => isSlow(s, slowThreshold))
      ? 1
      : 0,
    totalLatency,
    totalRequests,
    callsToday: todayStat ? sumDay(todayStat) : 0,
    errors24h,
  };
}

export async function getSummaryKpis(
  model: RouteStatisticsModel,
  totalRoutes: number,
  keys?: ScopeKeys,
): Promise<SummaryKpis> {
  const all = scopedStats(await model.getAll(), keys);
  const slowThreshold = getConfig().requestSlownessThreshold;
  const today = getTodayTimestamp();
  const last24hCutoff = today - MS_PER_DAY;

  const totals: KpiTotals = {
    routesWithErrors24h: 0,
    slowRoutesCount: 0,
    totalLatency: 0,
    totalRequests: 0,
    callsToday: 0,
    errors24h: 0,
  };
  for (const route of all) {
    const r = accumulateRouteKpis(route, today, last24hCutoff, slowThreshold);
    totals.routesWithErrors24h += r.routesWithErrors24h;
    totals.slowRoutesCount += r.slowRoutesCount;
    totals.totalLatency += r.totalLatency;
    totals.totalRequests += r.totalRequests;
    totals.callsToday += r.callsToday;
    totals.errors24h += r.errors24h;
  }

  return {
    totalRoutes,
    routesWithErrors24h: totals.routesWithErrors24h,
    slowRoutesCount: totals.slowRoutesCount,
    averageLatencyMs:
      totals.totalRequests > 0 ? totals.totalLatency / totals.totalRequests : 0,
    callsToday: totals.callsToday,
    errors24h: totals.errors24h,
  };
}

export async function getWatchList(
  model: RouteStatisticsModel,
  limit = 10,
  keys?: ScopeKeys,
): Promise<WatchListItem[]> {
  const all = scopedStats(await model.getAll(), keys);
  const config = getConfig();
  const today = getTodayTimestamp();
  const cutoff = today - MS_PER_DAY;

  const items: WatchListItem[] = [];
  for (const route of all) {
    const recent = route.statistics.filter((s) => s.day >= cutoff);
    const agg = combineAggregate(recent);
    if (agg.count === 0) continue;
    const errorRate = (agg.errClient + agg.errServer) / agg.count;
    const slow = route.statistics.some((s) =>
      isSlow(s, config.requestSlownessThreshold),
    );
    let flag: WatchListItem["flag"] | null = null;
    if (agg.errServer > 0) flag = "broken";
    else if (slow) flag = "slow";
    else if (errorRate >= ELEVATED_ERROR_RATE) flag = "warn";

    if (!flag) continue;
    items.push({
      routeKey: routeKey(route),
      method: route.method,
      uri: route.uri,
      errorRate,
      averageLatencyMs: agg.totalLatency / agg.count,
      requestsLast24h: agg.count,
      flag,
    });
  }

  return items
    .sort((a, b) => priorityRank(a.flag) - priorityRank(b.flag))
    .slice(0, limit);
}

/**
 * Total 2xx/4xx/5xx counts across every route, optionally restricted to
 * the last `days` days. Drives the status-breakdown donut. Computed from
 * the day-grained `RouteStatistics`, same source as the history chart so
 * the two stay consistent.
 */
export async function getStatusBreakdown(
  model: RouteStatisticsModel,
  days?: number,
  keys?: ScopeKeys,
): Promise<StatusBreakdown> {
  const all = scopedStats(await model.getAll(), keys);
  let success = 0;
  let clientErrors = 0;
  let serverErrors = 0;
  for (const route of all) {
    const stats =
      days && days > 0 ? lastNDays(route.statistics, days) : route.statistics;
    for (const s of stats) {
      clientErrors += s.clientErrorsCount;
      serverErrors += s.serverErrorsCount;
      success += s.requestsCount - s.clientErrorsCount - s.serverErrorsCount;
    }
  }
  if (success < 0) success = 0;
  return {
    success,
    clientErrors,
    serverErrors,
    total: success + clientErrors + serverErrors,
  };
}

function routeKey(route: RouteStatistics): string {
  return `${route.method.toUpperCase()}:${route.uri}`;
}

const FLAG_PRIORITY: Record<WatchListItem["flag"], number> = {
  broken: 0,
  slow: 1,
  warn: 2,
};

function priorityRank(flag: WatchListItem["flag"]): number {
  return FLAG_PRIORITY[flag];
}
