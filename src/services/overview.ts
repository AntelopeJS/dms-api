import type { ActivityFeedItem } from "@antelopejs/interface-dms/base/activity-feed";
import type { TopListItem } from "@antelopejs/interface-dms/base/top-list-card";
import { getConfig } from "@/config";
import type { RequestLogModel, RouteModel, RouteStatisticsModel } from "@/db";
import type { RequestLogSample } from "@/db/models/request_log.model";
import { MS_PER_MINUTE } from "@/types";
import { cached } from "./aggregate-cache";
import {
  evaluateHealth,
  HEALTH_THRESHOLDS,
  type HealthVerdict,
  type RuleWindowsInfo,
  ruleWindowsInfo,
} from "./health-rules";
import { percent, slowRouteDetail, text } from "./health-blocks";
import { logsLink, routeLink, routeRef } from "./links";
import {
  type RouteHealthState,
  type RouteState,
  evaluateRoutes,
  routesNeedingAttention,
} from "./route-health";
import {
  addSample,
  averageLatency,
  clientErrorShare,
  emptyBucket,
  errorShare,
  loadSamples,
  p95Latency,
  RECENT_SPAN_MS,
  type SampleSource,
  type ScopeKeys,
  scopeTraffic,
  serverErrorShare,
  sumBuckets,
  type TrafficBucket,
  windowTraffic,
} from "./traffic";
import {
  describeWindow,
  pinnedNow,
  type TimeRange,
  type TimeWindow,
  type WindowInfo,
} from "./window";

export interface OverviewModels {
  logs: RequestLogModel;
  stats: RouteStatisticsModel;
  routes: RouteModel;
}

export type { HealthVerdict };

export interface HealthMetric {
  value: number;
  /** Change against the previous 24 h, in percent; null without a baseline. */
  delta?: number | null;
  detail?: number;
}

/** The headline figures of the verdict, over its short window. */
export interface HealthMetrics {
  /** Share of 5xx, in percent. */
  serverErrorRate: number;
  /** Share of 4xx, in percent: shown second, a 4xx is often a refusal. */
  clientErrorRate: number;
  /** p95 of the measured durations, in ms; null without any. */
  p95Ms: number | null;
  requestsPerMinute: number;
  requests: number;
}

/** A range as the payloads carry it. */
export interface RangeInfo {
  from: string;
  to: string;
}

/** The API's health: what the Overview's banner and figures are made of. */
export interface HealthPayload {
  verdict: HealthVerdict;
  /** Start of the current incident, or of the last one; null when none (or older than the lookback). */
  incidentStart: string | null;
  /** When the last incident ended; null while it lasts or without one. */
  incidentEnd: string | null;
  /** How long the verdict has held, in ms; null when longer than the lookback. */
  durationMs: number | null;
  checkedAt: string;
  /** Over the last `thresholds.windowMinutes` minutes. */
  metrics: HealthMetrics;
  metricsWindow: RangeInfo;
  /**
   * The rate each rule read now, over its own window: the down rule's is
   * what a Down verdict rests on. Null without any call.
   */
  ruleWindows: RuleWindowsInfo | null;
  /**
   * Both rules and their windows: `degradedServerErrorRate` over
   * `windowMinutes`, `downServerErrorRate` over `downWindowMinutes`.
   */
  thresholds: typeof HEALTH_THRESHOLDS & { slowThresholdMs: number };
  /** The lookback the verdict, the route counts and the 24 h figures cover. */
  healthWindow: RangeInfo & { minutes: number };
  failingRoutes: number;
  recoveredRoutes: number;
  slowRoutes: number;
  /** 5xx over the lookback. */
  serverErrors: number;
  calls: HealthMetric;
  /** 4xx + 5xx over the lookback; the shares are in percent. */
  errors: HealthMetric & {
    share: number;
    serverShare: number;
    clientShare: number;
  };
  latency: HealthMetric & { max: number; p95: number | null };
  routes: HealthMetric & { needingAttention: number };
  /** Link to the server errors of the lookback. */
  serverErrorsLink: string;
  /** No request was ever captured: the Overview shows its first-run guide. */
  firstRun: boolean;
}

/** One point of a chart series the DMS charts read; null leaves a gap. */
export interface SeriesPoint {
  x: number;
  y: number | null;
}

export interface ChartSeriesPayload {
  name: string;
  data: SeriesPoint[];
}

/** Payload of a DMS `ChartCard`: a headline value, its delta, the series. */
export interface ChartCardPayload {
  value: number;
  previousValue?: number;
  /** Relative change in percent, or for a rate the difference in points. */
  delta?: number | null;
  deltaUnit?: "percent" | "pt";
  series: ChartSeriesPayload[];
  window?: WindowInfo;
}

/** One row of a DMS `TopListCard`. */
export type TopListItemPayload = TopListItem & { id: string };

/** One entry of a DMS `ActivityFeed`. */
export type FeedItemPayload = ActivityFeedItem & {
  id: string;
  icon: string;
  tone: NonNullable<ActivityFeedItem["tone"]>;
};

const PERCENT = 100;
const ONE_DECIMAL = 10;
const TWO_DECIMALS = 100;

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * PERCENT;
}

function roundTo(value: number, factor: number): number {
  return Math.round(value * factor) / factor;
}

/** A 0-1 ratio as a percentage with one decimal. */
export function roundPercent(ratio: number): number {
  return roundTo(ratio * PERCENT, ONE_DECIMAL);
}

export function rangeInfo(range: TimeRange): RangeInfo {
  return { from: range.from.toISOString(), to: range.to.toISOString() };
}

/** The last day before `now`: what the verdict and "Needs attention" judge. */
export function healthLookback(now: Date = new Date()): TimeRange {
  const to = pinnedNow(now);
  return { from: new Date(to.getTime() - RECENT_SPAN_MS), to };
}

/**
 * Every route judged by the health rules over the last 24 h. Routes are
 * judged one by one, so the result does not depend on the scope: it is
 * computed once for all of them and each reader keeps the routes it shows.
 */
export async function loadRouteHealth(
  models: { logs: SampleSource },
  now: Date = new Date(),
): Promise<{ lookback: TimeRange; routes: Map<string, RouteHealthState> }> {
  const lookback = healthLookback(now);
  const routes = await cached(
    `route-health:${+lookback.from}:${+lookback.to}`,
    async () =>
      evaluateRoutes(await loadSamples(models.logs, lookback, null), lookback),
  );
  return { lookback, routes };
}

export function inScopeRoutes(
  routes: Map<string, RouteHealthState>,
  keys: ScopeKeys,
): RouteHealthState[] {
  return [...routes.values()].filter((route) => !keys || keys.has(route.key));
}

function scopeId(keys: ScopeKeys): string {
  return keys ? [...keys].sort().join(",") : "*";
}

/** Requests logged over `range`, counted by the database rather than read. */
function countRequests(
  models: OverviewModels,
  range: TimeRange,
  keys: ScopeKeys,
): Promise<number> {
  if (keys && keys.size === 0) return Promise.resolve(0);
  return cached(
    `count:${scopeId(keys)}:${+range.from}:${+range.to}`,
    async () => {
      const page = await models.logs.list(
        {
          since: range.from,
          until: range.to,
          routeKeys: keys ? [...keys] : undefined,
          apiTrafficOnly: true,
        },
        { limit: 0 },
      );
      return page.total;
    },
  );
}

async function hasAnyRequest(models: OverviewModels): Promise<boolean> {
  const page = await models.logs.query({ limit: 1 });
  return page.results.length > 0;
}

function totalOf(samples: RequestLogSample[]): TrafficBucket {
  const total = emptyBucket(0);
  for (const sample of samples) addSample(total, sample);
  return total;
}

function shortWindowMetrics(
  samples: RequestLogSample[],
  range: TimeRange,
): HealthMetrics {
  const from = range.from.getTime();
  const recent = samples.filter(
    (sample) => new Date(sample.timestamp).getTime() >= from,
  );
  const traffic = totalOf(recent);
  const p95 = p95Latency(traffic);
  return {
    serverErrorRate: roundTo(serverErrorShare(traffic) * PERCENT, TWO_DECIMALS),
    clientErrorRate: roundTo(clientErrorShare(traffic) * PERCENT, TWO_DECIMALS),
    p95Ms: p95 === null ? null : Math.round(p95),
    requestsPerMinute: roundTo(
      traffic.requests / HEALTH_THRESHOLDS.windowMinutes,
      ONE_DECIMAL,
    ),
    requests: traffic.requests,
  };
}

/**
 * The health hero: the verdict of the rules (see `route-health.ts`), when
 * the incident started and ended, the headline metrics over the last 15
 * minutes, and the figures of the last 24 h.
 */
export async function getHealth(
  models: OverviewModels,
  keys: ScopeKeys,
  routeCount: number,
  now: Date = new Date(),
): Promise<HealthPayload> {
  const lookback = healthLookback(now);
  const previous: TimeRange = {
    from: new Date(lookback.from.getTime() - RECENT_SPAN_MS),
    to: lookback.from,
  };
  const slowThresholdMs = getConfig().requestSlownessThreshold;
  const [samples, previousCalls, routeHealth] = await Promise.all([
    loadSamples(models.logs, lookback, keys),
    countRequests(models, previous, keys),
    loadRouteHealth(models, now),
  ]);
  const traffic = totalOf(samples);
  const health = evaluateHealth(samples, lookback, slowThresholdMs, true);
  const routes = inScopeRoutes(routeHealth.routes, keys);
  const count = (state: RouteState) =>
    routes.filter((route) => route.state === state).length;
  const metricsWindow: TimeRange = {
    from: new Date(
      lookback.to.getTime() - HEALTH_THRESHOLDS.windowMinutes * MS_PER_MINUTE,
    ),
    to: lookback.to,
  };
  const incidentStart = health.incident?.start?.toISOString() ?? null;
  const p95 = p95Latency(traffic);
  return {
    verdict: health.verdict,
    incidentStart,
    incidentEnd: health.incident?.end?.toISOString() ?? null,
    durationMs: health.durationMs,
    checkedAt: now.toISOString(),
    metrics: shortWindowMetrics(samples, metricsWindow),
    metricsWindow: rangeInfo(metricsWindow),
    ruleWindows: ruleWindowsInfo(health.windows),
    thresholds: { ...HEALTH_THRESHOLDS, slowThresholdMs },
    healthWindow: {
      ...rangeInfo(lookback),
      minutes: HEALTH_THRESHOLDS.lookbackMinutes,
    },
    failingRoutes: count("failing"),
    recoveredRoutes: count("recovered"),
    slowRoutes: count("slow"),
    serverErrors: traffic.serverErrors,
    calls: {
      value: traffic.requests,
      delta: percentChange(traffic.requests, previousCalls),
    },
    errors: {
      value: traffic.clientErrors + traffic.serverErrors,
      share: roundPercent(errorShare(traffic)),
      serverShare: roundPercent(serverErrorShare(traffic)),
      clientShare: roundPercent(clientErrorShare(traffic)),
    },
    latency: {
      value: Math.round(averageLatency(traffic)),
      max: Math.round(traffic.maxLatency),
      p95: p95 === null ? null : Math.round(p95),
    },
    routes: {
      value: routeCount,
      needingAttention: routesNeedingAttention(routes).length,
    },
    serverErrorsLink: logsLink({ tab: "5xx", window: "24h", from: "overview" }),
    firstRun: traffic.requests === 0 && !(await hasAnyRequest(models)),
  };
}

/** The window's traffic in scope, and the previous period's if compared. */
async function scopedWindowTraffic(
  models: OverviewModels,
  window: TimeWindow,
  keys: ScopeKeys,
) {
  const [current, previous] = await Promise.all([
    windowTraffic(models, window, window.granularity),
    window.previous
      ? windowTraffic(models, window.previous, window.granularity)
      : Promise.resolve(null),
  ]);
  return {
    current: scopeTraffic(current, keys),
    previous: previous ? scopeTraffic(previous, keys) : null,
  };
}

const SERIES_CLIENT = "$api.overview.error_share.client";
const SERIES_SERVER = "$api.overview.error_share.server";

/** `count` of a bucket, or a gap for a bucket nobody called. */
function countOrGap(count: number, bucket: TrafficBucket): number | null {
  return bucket.requests > 0 ? count : null;
}

/**
 * Requests per bucket split by status class, for stacked columns, against
 * the previous period. Without a previous period kept, no comparison at all.
 */
export async function getTrafficChart(
  models: OverviewModels,
  window: TimeWindow,
  keys: ScopeKeys,
): Promise<ChartCardPayload> {
  const { current, previous } = await scopedWindowTraffic(models, window, keys);
  const value = sumBuckets(current).requests;
  const series = (
    name: string,
    count: (bucket: TrafficBucket) => number,
  ): ChartSeriesPayload => ({
    name,
    data: current.map((bucket) => ({
      x: bucket.start,
      y: countOrGap(count(bucket), bucket),
    })),
  });
  const payload: ChartCardPayload = {
    value,
    series: [
      series(
        "$api.overview.traffic.2xx",
        (bucket) => bucket.requests - bucket.clientErrors - bucket.serverErrors,
      ),
      series("$api.overview.traffic.4xx", (bucket) => bucket.clientErrors),
      series("$api.overview.traffic.5xx", (bucket) => bucket.serverErrors),
    ],
    window: describeWindow(window),
  };
  if (!previous) return payload;
  const previousValue = sumBuckets(previous).requests;
  return {
    ...payload,
    previousValue,
    delta: percentChange(value, previousValue),
    deltaUnit: "percent",
  };
}

/** `part` of a bucket's calls in percent; null for a bucket nobody called. */
function shareOrGap(part: number, bucket: TrafficBucket): number | null {
  return bucket.requests > 0 ? roundPercent(part / bucket.requests) : null;
}

/**
 * Share of 4xx and 5xx per bucket, in percent. 2xx is left out so a small
 * rise of the errors stays visible instead of disappearing under a full bar;
 * a bucket without a call is a gap, not a 0 %. The delta is in points.
 */
export async function getErrorShareChart(
  models: OverviewModels,
  window: TimeWindow,
  keys: ScopeKeys,
): Promise<ChartCardPayload> {
  const { current, previous } = await scopedWindowTraffic(models, window, keys);
  const value = roundPercent(errorShare(sumBuckets(current)));
  const previousValue = previous
    ? roundPercent(errorShare(sumBuckets(previous)))
    : undefined;
  const chart: ChartCardPayload = {
    value,
    series: [
      {
        name: SERIES_CLIENT,
        data: current.map((bucket) => ({
          x: bucket.start,
          y: shareOrGap(bucket.clientErrors, bucket),
        })),
      },
      {
        name: SERIES_SERVER,
        data: current.map((bucket) => ({
          x: bucket.start,
          y: shareOrGap(bucket.serverErrors, bucket),
        })),
      },
    ],
    window: describeWindow(window),
  };
  if (previousValue !== undefined) {
    chart.previousValue = previousValue;
    chart.delta = roundTo(value - previousValue, ONE_DECIMAL);
    chart.deltaUnit = "pt";
  }
  return chart;
}

type StatusClass = "2xx" | "4xx" | "5xx";

interface StatusClassRow {
  id: StatusClass;
  icon: string;
  count: (bucket: TrafficBucket) => number;
}

const STATUS_CLASS_ROWS: StatusClassRow[] = [
  {
    id: "2xx",
    icon: "i-ph-check-circle",
    count: (bucket) =>
      bucket.requests - bucket.clientErrors - bucket.serverErrors,
  },
  {
    id: "4xx",
    icon: "i-ph-warning",
    count: (bucket) => bucket.clientErrors,
  },
  {
    id: "5xx",
    icon: "i-ph-x-circle",
    count: (bucket) => bucket.serverErrors,
  },
];

/** A status class row: its count as the value, its share as a number. */
export interface StatusClassItem extends TopListItemPayload {
  statusClass: StatusClass;
  /** Share of the window's calls, in percent (one decimal). */
  share: number;
}

/** Responses by status class over the window, with their share. */
export async function getStatusClasses(
  models: OverviewModels,
  window: TimeWindow,
  keys: ScopeKeys,
): Promise<{ items: StatusClassItem[]; total: number; window: WindowInfo }> {
  const total = sumBuckets(
    scopeTraffic(await windowTraffic(models, window, window.granularity), keys),
  );
  const info = describeWindow(window);
  if (total.requests === 0) return { items: [], total: 0, window: info };
  return {
    items: STATUS_CLASS_ROWS.map((row) => {
      const calls = row.count(total);
      return {
        id: row.id,
        statusClass: row.id,
        title: `$api.overview.classes.${row.id}`,
        description: text("overview.classes.share", {
          share: percent(roundPercent(calls / total.requests)),
        }),
        value: calls,
        share: roundPercent(calls / total.requests),
        icon: row.icon,
        to: logsLink({ tab: row.id, window: window.preset, from: "overview" }),
      };
    }),
    total: total.requests,
    window: info,
  };
}

const SLOWEST_LIMIT = 5;

/** A slowest-routes row: its average as the value, the rest as numbers. */
export interface SlowRouteItem extends TopListItemPayload {
  route: string;
  averageMs: number;
  /**
   * Exact over a window read from the logs, estimated from the latency
   * histograms over a longer one, never above `maxMs`; null without a
   * measured call.
   */
  p95Ms: number | null;
  maxMs: number;
  requests: number;
}

/** The routes with the highest average latency over the window. */
export async function getSlowestRoutes(
  models: OverviewModels,
  window: TimeWindow,
  keys: ScopeKeys,
): Promise<{ items: SlowRouteItem[]; window: WindowInfo }> {
  const traffic = await windowTraffic(models, window, window.granularity);
  const rows: Array<{ key: string; total: TrafficBucket }> = [];
  for (const [key, buckets] of traffic.routes) {
    if (keys && !keys.has(key)) continue;
    const total = sumBuckets(buckets);
    if (total.requests > 0) rows.push({ key, total });
  }
  const items = rows
    .sort((a, b) => averageLatency(b.total) - averageLatency(a.total))
    .slice(0, SLOWEST_LIMIT)
    .map(({ key, total }) => {
      const separator = key.indexOf(":");
      const ref = routeRef(key.slice(0, separator), key.slice(separator + 1));
      const p95 = p95Latency(total);
      const average = Math.round(averageLatency(total));
      return {
        id: ref,
        title: ref,
        description: slowRouteDetail({
          p95,
          calls: total.requests,
          max: total.maxLatency,
        }),
        route: ref,
        value: average,
        averageMs: average,
        p95Ms: p95 === null ? null : Math.round(p95),
        maxMs: Math.round(total.maxLatency),
        requests: total.requests,
        to: routeLink(ref, undefined, window.preset),
      };
    });
  return { items, window: describeWindow(window) };
}
