import type { RequestLogModel, RouteStatisticsModel } from "@/db";
import type { RouteStatistics } from "@/db/tables/routes_statistics.table";
import type { DayStatistics } from "@/types";
import { MS_PER_DAY } from "@/types";
import { loadRouteHealth } from "./overview";
import type { RouteState } from "./route-health";
import { scopeRouteKey } from "./scope";
import { getTodayTimestamp } from "./statistics-utils";
import { averageLatency, errorShare } from "./traffic";

/**
 * Aggregated readers used by the automation actions and triggers. The route
 * states come from the health rules (see `route-health.ts`), the same the
 * Overview and the routes tree show; the volumes from the day rollups.
 */

export interface SummaryKpis {
  totalRoutes: number;
  /** Routes failing now, by the health rules. */
  routesWithErrors24h: number;
  /** Routes whose p95 over the last 24 h is at or above the slow threshold. */
  slowRoutesCount: number;
  averageLatencyMs: number;
  callsToday: number;
  errors24h: number;
}

export interface WatchListItem {
  routeKey: string;
  method: string;
  uri: string;
  /** Share (0-1) of 4xx and 5xx over the last 24 h. */
  errorRate: number;
  averageLatencyMs: number;
  requestsLast24h: number;
  flag: "broken" | "slow" | "warn";
}

/**
 * Total request counts split by HTTP status class. `success` is every
 * non-error request (2xx/3xx); the two error buckets mirror the
 * day-statistics counters.
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
  return all.filter((route) =>
    keys.has(scopeRouteKey(route.method, route.uri)),
  );
}

function lastNDays(stats: DayStatistics[], n: number): DayStatistics[] {
  const today = getTodayTimestamp();
  const cutoff = today - (n - 1) * MS_PER_DAY;
  return stats.filter((s) => s.day >= cutoff);
}

/** Routes in scope per state, by the health rules. */
async function countStates(
  logs: RequestLogModel,
  keys: ScopeKeys,
): Promise<Map<RouteState, number>> {
  const { routes } = await loadRouteHealth({ logs });
  const counts = new Map<RouteState, number>();
  for (const route of routes.values()) {
    if (keys && !keys.has(route.key)) continue;
    counts.set(route.state, (counts.get(route.state) ?? 0) + 1);
  }
  return counts;
}

export async function getSummaryKpis(
  models: { logs: RequestLogModel; stats: RouteStatisticsModel },
  totalRoutes: number,
  keys?: ScopeKeys,
): Promise<SummaryKpis> {
  const [all, states] = await Promise.all([
    models.stats.getAll().then((rows) => scopedStats(rows, keys)),
    countStates(models.logs, keys),
  ]);
  const today = getTodayTimestamp();
  const last24hCutoff = today - MS_PER_DAY;
  let timedRequests = 0;
  let totalLatency = 0;
  let callsToday = 0;
  let errors24h = 0;
  for (const route of all) {
    for (const day of route.statistics) {
      timedRequests += day.timedRequestsCount ?? day.requestsCount;
      totalLatency += day.totalResponseTime;
      if (day.day === today) callsToday += day.requestsCount;
      if (day.day >= last24hCutoff) {
        errors24h += day.clientErrorsCount + day.serverErrorsCount;
      }
    }
  }
  return {
    totalRoutes,
    routesWithErrors24h: states.get("failing") ?? 0,
    slowRoutesCount: states.get("slow") ?? 0,
    averageLatencyMs: timedRequests > 0 ? totalLatency / timedRequests : 0,
    callsToday,
    errors24h,
  };
}

const WATCH_FLAGS: Partial<Record<RouteState, WatchListItem["flag"]>> = {
  failing: "broken",
  slow: "slow",
  "client-errors": "warn",
};

const FLAG_PRIORITY: Record<WatchListItem["flag"], number> = {
  broken: 0,
  slow: 1,
  warn: 2,
};

/**
 * Routes in a bad state by the health rules, worst first: failing (broken),
 * slow, then answering many 4xx (warn). A route that recovered leaves the
 * list.
 */
export async function getWatchList(
  logs: RequestLogModel,
  limit = 10,
  keys?: ScopeKeys,
): Promise<WatchListItem[]> {
  const { routes } = await loadRouteHealth({ logs });
  const items: WatchListItem[] = [];
  for (const route of routes.values()) {
    const flag = WATCH_FLAGS[route.state];
    if (!flag || (keys && !keys.has(route.key))) continue;
    items.push({
      routeKey: route.key,
      method: route.method,
      uri: route.uri,
      errorRate: errorShare(route.traffic),
      averageLatencyMs: averageLatency(route.traffic),
      requestsLast24h: route.traffic.requests,
      flag,
    });
  }
  return items
    .sort((a, b) => FLAG_PRIORITY[a.flag] - FLAG_PRIORITY[b.flag])
    .slice(0, limit);
}

/**
 * Total 2xx/4xx/5xx counts across every route, optionally restricted to
 * the last `days` days, from the day rollups.
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
