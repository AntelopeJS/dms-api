import { getConfig } from "@/config";
import type { RequestLogModel, RouteStatisticsModel } from "@/db";
import type { RequestLog } from "@/db/tables/request_log.table";
import type { RouteStatistics } from "@/db/tables/routes_statistics.table";
import type { DayStatistics } from "@/types";
import {
  ELEVATED_ERROR_RATE,
  MAX_HOURLY_HOURS,
  MAX_MINUTELY_MINUTES,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
} from "@/types";
import { queryRequestLogsScoped } from "./request-log/read";
import {
  buildDayStatsMap,
  getDayInfo,
  getTodayTimestamp,
} from "./statistics-utils";

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

export interface HistoryPoint {
  day: number;
  label: string;
  success: number;
  clientErrors: number;
  serverErrors: number;
  slow: number;
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

export interface RouteAggregate {
  routeKey: string;
  method: string;
  uri: string;
  requestsCount: number;
  averageLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  errorsClient: number;
  errorsServer: number;
  errorRate: number;
}

export interface FolderAggregate extends RouteAggregate {
  matchedRoutes: number;
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

export async function getRequestHistory(
  model: RouteStatisticsModel,
  days: number,
  keys?: ScopeKeys,
): Promise<HistoryPoint[]> {
  const all = scopedStats(await model.getAll(), keys);
  const dayInfo = getDayInfo(days);
  const config = getConfig();

  const byDay = new Map<number, HistoryPoint>();
  for (const { timestamp, label } of dayInfo) {
    byDay.set(timestamp, {
      day: timestamp,
      label,
      success: 0,
      clientErrors: 0,
      serverErrors: 0,
      slow: 0,
    });
  }

  for (const route of all) {
    const map = buildDayStatsMap(route.statistics);
    for (const { timestamp } of dayInfo) {
      const dayStat = map.get(timestamp);
      const point = byDay.get(timestamp);
      if (!dayStat || !point) continue;
      point.success += dayStat.requestsCount - totalErrors(dayStat);
      point.clientErrors += dayStat.clientErrorsCount;
      point.serverErrors += dayStat.serverErrorsCount;
      if (isSlow(dayStat, config.requestSlownessThreshold)) {
        point.slow += 1;
      }
    }
  }

  return dayInfo
    .map(({ timestamp }) => byDay.get(timestamp))
    .filter((p): p is HistoryPoint => p !== undefined);
}

/**
 * Bucketed history derived from RequestLog.
 *
 * RouteStatistics is day-grained, so sub-day windows would collapse to
 * one point. This helper buckets per-request log entries at whatever
 * width fits the window. Callers pick `bucketMs` and a label formatter;
 * see {@link getRequestHistoryHourly} / {@link getRequestHistoryMinutely}
 * for the two granularities the UI uses today.
 *
 * The bucket count is bounded only by the callers' window clamps
 * (`MAX_HOURLY_HOURS` hourly buckets, `MAX_MINUTELY_MINUTES` minutely
 * buckets). Log pages are pulled until exhausted; the requested page size
 * (5000) is clamped to 200 by `RequestLogModel.query`, so effective pages
 * hold at most 200 entries. The route scope, when set, is part of the query
 * so those pages only carry in-scope entries.
 */
const LOG_PAGE_SIZE = 5000;

function initBuckets(
  bucketCount: number,
  startBucket: number,
  bucketMs: number,
  labeller: (bucketStartMs: number) => string,
): Map<number, HistoryPoint> {
  const buckets = new Map<number, HistoryPoint>();
  for (let i = 0; i < bucketCount; i++) {
    const bucketIndex = startBucket + i + 1;
    const ts = bucketIndex * bucketMs;
    buckets.set(bucketIndex, {
      day: ts,
      label: labeller(ts),
      success: 0,
      clientErrors: 0,
      serverErrors: 0,
      slow: 0,
    });
  }
  return buckets;
}

function tallyLog(
  buckets: Map<number, HistoryPoint>,
  log: RequestLog,
  bucketMs: number,
  slowMs: number,
): void {
  const bucketIndex = Math.floor(log.timestamp.getTime() / bucketMs);
  const point = buckets.get(bucketIndex);
  if (!point) return;
  if (log.statusCode >= 500) point.serverErrors += 1;
  else if (log.statusCode >= 400) point.clientErrors += 1;
  else point.success += 1;
  if (log.responseTimeMs >= slowMs) point.slow += 1;
}

async function bucketHistoryFromLogs(
  model: RequestLogModel,
  windowMs: number,
  bucketMs: number,
  labeller: (bucketStartMs: number) => string,
  keys?: ScopeKeys,
): Promise<HistoryPoint[]> {
  const slowMs = getConfig().requestSlownessThreshold;
  const now = Date.now();
  const bucketCount = Math.max(1, Math.floor(windowMs / bucketMs));
  const startBucket = Math.floor((now - bucketCount * bucketMs) / bucketMs);
  const buckets = initBuckets(bucketCount, startBucket, bucketMs, labeller);

  const since = new Date(now - bucketCount * bucketMs);
  let cursor: string | undefined;
  for (;;) {
    // Scoped through the same helper the Logs page uses, so the scope is
    // expressed in exactly one place: it goes to the query, and every page
    // comes back full of in-scope entries instead of rows discarded on arrival.
    const page = await queryRequestLogsScoped(
      model,
      { since, limit: LOG_PAGE_SIZE, cursor },
      keys,
    );
    for (const log of page.results) {
      tallyLog(buckets, log, bucketMs, slowMs);
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  return [...buckets.values()].sort((a, b) => a.day - b.day);
}

export function getRequestHistoryHourly(
  model: RequestLogModel,
  hours: number,
  keys?: ScopeKeys,
): Promise<HistoryPoint[]> {
  const safe = Math.max(1, Math.min(MAX_HOURLY_HOURS, hours));
  return bucketHistoryFromLogs(
    model,
    safe * MS_PER_HOUR,
    MS_PER_HOUR,
    (ts) => `${String(new Date(ts).getHours()).padStart(2, "0")}:00`,
    keys,
  );
}

export function getRequestHistoryMinutely(
  model: RequestLogModel,
  minutes: number,
  keys?: ScopeKeys,
): Promise<HistoryPoint[]> {
  const safe = Math.max(1, Math.min(MAX_MINUTELY_MINUTES, minutes));
  return bucketHistoryFromLogs(
    model,
    safe * MS_PER_MINUTE,
    MS_PER_MINUTE,
    (ts) => {
      const d = new Date(ts);
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    },
    keys,
  );
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

export async function getRouteAggregates(
  model: RouteStatisticsModel,
  days: number,
  keys?: ScopeKeys,
): Promise<RouteAggregate[]> {
  const all = scopedStats(await model.getAll(), keys);
  return all.map((route) => routeAggregateFor(route, days));
}

function routeAggregateFor(
  route: RouteStatistics,
  days: number,
): RouteAggregate {
  const stats = lastNDays(route.statistics, days);
  const agg = combineAggregate(stats);
  return {
    routeKey: routeKey(route),
    method: route.method,
    uri: route.uri,
    requestsCount: agg.count,
    averageLatencyMs: agg.count > 0 ? agg.totalLatency / agg.count : 0,
    minLatencyMs: agg.min,
    maxLatencyMs: agg.max,
    errorsClient: agg.errClient,
    errorsServer: agg.errServer,
    errorRate: agg.count > 0 ? (agg.errClient + agg.errServer) / agg.count : 0,
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

export async function getRouteAggregate(
  model: RouteStatisticsModel,
  method: string,
  uri: string,
  days: number,
): Promise<RouteAggregate | undefined> {
  const route = await model.getByRoute(method, uri);
  if (!route) return undefined;
  return routeAggregateFor(route, days);
}

export async function getFolderAggregate(
  model: RouteStatisticsModel,
  urlPath: string,
  days: number,
): Promise<FolderAggregate> {
  const all = await model.getAll();
  const prefixSegs = urlPath.split("/").filter(Boolean);
  const matched = all.filter((route) => {
    const segs = route.uri.split("/").filter(Boolean);
    if (segs.length < prefixSegs.length) return false;
    for (let i = 0; i < prefixSegs.length; i++) {
      if (prefixSegs[i] !== segs[i]) return false;
    }
    return true;
  });

  const merged: DayStatistics[] = [];
  for (const route of matched) {
    for (const stat of lastNDays(route.statistics, days)) {
      merged.push(stat);
    }
  }
  const agg = combineAggregate(merged);
  return {
    routeKey: urlPath,
    method: "*",
    uri: urlPath,
    requestsCount: agg.count,
    averageLatencyMs: agg.count > 0 ? agg.totalLatency / agg.count : 0,
    minLatencyMs: agg.min,
    maxLatencyMs: agg.max,
    errorsClient: agg.errClient,
    errorsServer: agg.errServer,
    errorRate: agg.count > 0 ? (agg.errClient + agg.errServer) / agg.count : 0,
    matchedRoutes: matched.length,
  };
}
