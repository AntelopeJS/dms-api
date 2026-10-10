import type { RequestLogModel, RouteModel, RouteStatisticsModel } from "@/db";
import type { RequestLogSample } from "@/db/models/request_log.model";
import { CRITICAL_ERROR_RATE, MS_PER_DAY } from "@/types";
import { logsLink, routeLink, routeRef } from "./links";
import {
  computeRouteHealth,
  type RouteHealth,
  routesNeedingAttention,
} from "./route-health";
import {
  averageLatency,
  bucketSamples,
  errorShare,
  loadSamples,
  loadTraffic,
  type ScopeKeys,
  sumBuckets,
  type TrafficBucket,
} from "./traffic";
import type { TimeRange, TimeWindow } from "./window";

export interface OverviewModels {
  logs: RequestLogModel;
  stats: RouteStatisticsModel;
  routes: RouteModel;
}

/** Overall state of the API, worst first. */
export type HealthVerdict = "down" | "degraded" | "operational" | "idle";

export interface HealthMetric {
  value: number;
  /** Change against the previous 24 h, in percent; null without a baseline. */
  delta?: number | null;
  detail?: number;
}

/** What the health hero of the Overview draws. */
export interface HealthPayload {
  verdict: HealthVerdict;
  /** Start of the current incident, or of the last one when operational. */
  since: string | null;
  checkedAt: string;
  failingRoutes: number;
  slowRoutes: number;
  serverErrors: number;
  calls: HealthMetric;
  errors: HealthMetric & { share: number };
  latency: HealthMetric & { max: number };
  routes: HealthMetric & { needingAttention: number };
  /** Link to the server errors of the last 24 h. */
  serverErrorsLink: string;
  /** No request was ever captured: the Overview shows its first-run guide. */
  firstRun: boolean;
}

/** One point of a chart series the DMS charts read. */
export interface SeriesPoint {
  x: number;
  y: number;
}

export interface ChartSeriesPayload {
  name: string;
  data: SeriesPoint[];
}

/** Payload of a DMS `ChartCard`: a headline value, its delta, the series. */
export interface ChartCardPayload {
  value: number;
  previousValue?: number;
  delta?: number | null;
  series: ChartSeriesPayload[];
}

/** One row of a DMS `TopListCard`. */
export interface TopListItemPayload {
  id: string;
  title: string;
  description?: string;
  value: number;
  icon?: string;
  to?: string;
}

/** One entry of a DMS `ActivityFeed`. */
export interface FeedItemPayload {
  id: string;
  icon: string;
  tone: "error" | "warning" | "info" | "success" | "primary" | "neutral";
  title: string;
  meta?: string[];
  params?: Record<string, string>;
  date?: string;
  to?: string;
}

const PERCENT = 100;
const ONE_DECIMAL = 10;
const LAST_24H_MS = MS_PER_DAY;

function last24h(now: Date): TimeRange {
  return { from: new Date(now.getTime() - LAST_24H_MS), to: now };
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * PERCENT;
}

function roundPercent(ratio: number): number {
  return Math.round(ratio * PERCENT * ONE_DECIMAL) / ONE_DECIMAL;
}

function verdictOf(
  traffic: TrafficBucket,
  attention: RouteHealth[],
): HealthVerdict {
  if (traffic.requests === 0) return "idle";
  if (traffic.serverErrors / traffic.requests > CRITICAL_ERROR_RATE) {
    return "down";
  }
  return attention.some(
    (route) => route.issue === "failing" || route.issue === "slow",
  )
    ? "degraded"
    : "operational";
}

/** Oldest server error of the current window, else the last one ever. */
async function incidentStart(
  models: OverviewModels,
  samples: RequestLogSample[],
  keys: ScopeKeys,
): Promise<Date | null> {
  const errors = samples
    .filter((sample) => sample.statusCode >= 500)
    .map((sample) => new Date(sample.timestamp).getTime());
  if (errors.length > 0) return new Date(Math.min(...errors));
  if (keys && keys.size === 0) return null;
  const page = await models.logs.query({
    statusClass: "server-error",
    limit: 1,
    routeKeys: keys ? [...keys] : undefined,
  });
  return page.results[0]?.timestamp ?? null;
}

async function hasAnyRequest(models: OverviewModels): Promise<boolean> {
  const page = await models.logs.query({ limit: 1 });
  return page.results.length > 0;
}

/** The health hero: verdict, reasons and the four headline metrics. */
export async function getHealth(
  models: OverviewModels,
  keys: ScopeKeys,
  routeCount: number,
  now: Date = new Date(),
): Promise<HealthPayload> {
  const range = last24h(now);
  const previous: TimeRange = {
    from: new Date(range.from.getTime() - LAST_24H_MS),
    to: range.from,
  };
  const [samples, previousSamples] = await Promise.all([
    loadSamples(models.logs, range, keys),
    loadSamples(models.logs, previous, keys),
  ]);
  const traffic = sumBuckets(bucketSamples(samples, range, "day"));
  const before = sumBuckets(bucketSamples(previousSamples, previous, "day"));
  const attention = routesNeedingAttention(
    computeRouteHealth(samples).values(),
  );
  const since = await incidentStart(models, samples, keys);
  const count = (issue: RouteHealth["issue"]) =>
    attention.filter((route) => route.issue === issue).length;
  return {
    verdict: verdictOf(traffic, attention),
    since: since?.toISOString() ?? null,
    checkedAt: now.toISOString(),
    failingRoutes: count("failing"),
    slowRoutes: count("slow"),
    serverErrors: traffic.serverErrors,
    calls: {
      value: traffic.requests,
      delta: percentChange(traffic.requests, before.requests),
    },
    errors: {
      value: traffic.clientErrors + traffic.serverErrors,
      share: roundPercent(errorShare(traffic)),
    },
    latency: {
      value: Math.round(averageLatency(traffic)),
      max: Math.round(traffic.maxLatency),
    },
    routes: { value: routeCount, needingAttention: attention.length },
    serverErrorsLink: logsLink({ tab: "5xx" }),
    firstRun: traffic.requests === 0 && !(await hasAnyRequest(models)),
  };
}

async function windowTraffic(
  models: OverviewModels,
  window: TimeWindow,
  keys: ScopeKeys,
) {
  const [current, previous] = await Promise.all([
    loadTraffic(models, window, window.granularity, keys),
    window.previous
      ? loadTraffic(models, window.previous, window.granularity, keys)
      : Promise.resolve(null),
  ]);
  return { current, previous };
}

const SERIES_REQUESTS = "$api.overview.traffic.requests";
const SERIES_ERRORS = "$api.overview.traffic.errors";
const SERIES_CLIENT = "$api.overview.error_share.client";
const SERIES_SERVER = "$api.overview.error_share.server";

/** Requests and errors over the window, against the previous one. */
export async function getTrafficChart(
  models: OverviewModels,
  window: TimeWindow,
  keys: ScopeKeys,
): Promise<ChartCardPayload> {
  const { current, previous } = await windowTraffic(models, window, keys);
  const value = sumBuckets(current).requests;
  const previousValue = previous ? sumBuckets(previous).requests : undefined;
  return {
    value,
    previousValue,
    delta:
      previousValue === undefined ? null : percentChange(value, previousValue),
    series: [
      {
        name: SERIES_REQUESTS,
        data: current.map((bucket) => ({
          x: bucket.start,
          y: bucket.requests,
        })),
      },
      {
        name: SERIES_ERRORS,
        data: current.map((bucket) => ({
          x: bucket.start,
          y: bucket.clientErrors + bucket.serverErrors,
        })),
      },
    ],
  };
}

function share(part: number, bucket: TrafficBucket): number {
  return bucket.requests > 0 ? roundPercent(part / bucket.requests) : 0;
}

/**
 * Share of 4xx and 5xx per bucket. 2xx is left out so a small rise of the
 * errors stays visible instead of disappearing under a full bar.
 */
export async function getErrorShareChart(
  models: OverviewModels,
  window: TimeWindow,
  keys: ScopeKeys,
): Promise<ChartCardPayload> {
  const { current, previous } = await windowTraffic(models, window, keys);
  const value = roundPercent(errorShare(sumBuckets(current)));
  const previousValue = previous
    ? roundPercent(errorShare(sumBuckets(previous)))
    : undefined;
  return {
    value,
    previousValue,
    delta:
      previousValue === undefined ? null : percentChange(value, previousValue),
    series: [
      {
        name: SERIES_CLIENT,
        data: current.map((bucket) => ({
          x: bucket.start,
          y: share(bucket.clientErrors, bucket),
        })),
      },
      {
        name: SERIES_SERVER,
        data: current.map((bucket) => ({
          x: bucket.start,
          y: share(bucket.serverErrors, bucket),
        })),
      },
    ],
  };
}

interface StatusClassRow {
  id: "2xx" | "4xx" | "5xx";
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

/** Responses by status class over the window, with their share. */
export async function getStatusClasses(
  models: OverviewModels,
  window: TimeWindow,
  keys: ScopeKeys,
): Promise<{ items: TopListItemPayload[] }> {
  const total = sumBuckets(
    await loadTraffic(models, window, window.granularity, keys),
  );
  if (total.requests === 0) return { items: [] };
  return {
    items: STATUS_CLASS_ROWS.map((row) => {
      const count = row.count(total);
      return {
        id: row.id,
        title: `$api.overview.classes.${row.id}`,
        description: `${share(count, total)} %`,
        value: count,
        icon: row.icon,
        to: logsLink({ tab: row.id }),
      };
    }),
  };
}

const SLOWEST_LIMIT = 5;

/** The routes with the highest average latency over the window. */
export async function getSlowestRoutes(
  models: OverviewModels,
  window: TimeWindow,
  keys: ScopeKeys,
): Promise<{ items: TopListItemPayload[] }> {
  const rollups = await models.stats.getAll();
  const fromDay = new Date(window.from);
  fromDay.setHours(0, 0, 0, 0);
  const items = rollups
    .filter(
      (route) =>
        !keys || keys.has(`${route.method.toUpperCase()}:${route.uri}`),
    )
    .map((route) => {
      const days = route.statistics.filter(
        (day) => day.day >= fromDay.getTime(),
      );
      const requests = days.reduce((sum, day) => sum + day.requestsCount, 0);
      const latency = days.reduce((sum, day) => sum + day.totalResponseTime, 0);
      const max = days.reduce(
        (worst, day) => Math.max(worst, day.maxResponseTime),
        0,
      );
      return {
        route,
        requests,
        average: requests ? latency / requests : 0,
        max,
      };
    })
    .filter((entry) => entry.requests > 0)
    .sort((a, b) => b.average - a.average)
    .slice(0, SLOWEST_LIMIT);
  return {
    items: items.map(({ route, average, max, requests }) => {
      const ref = routeRef(route.method, route.uri);
      return {
        id: ref,
        title: ref,
        description: `max ${Math.round(max)} ms · ×${requests}`,
        value: Math.round(average),
        to: routeLink(ref),
      };
    }),
  };
}

const ISSUE_FEED: Record<
  NonNullable<RouteHealth["issue"]>,
  Pick<FeedItemPayload, "icon" | "tone">
> = {
  failing: { icon: "i-ph-x-circle", tone: "error" },
  slow: { icon: "i-ph-timer", tone: "warning" },
  "client-errors": { icon: "i-ph-warning", tone: "warning" },
};

function attentionParams(route: RouteHealth): Record<string, string> {
  const { traffic } = route;
  const top = route.errors.find((group) =>
    route.issue === "failing" ? group.status >= 500 : group.status < 500,
  );
  return {
    calls: String(traffic.requests),
    serverErrors: String(traffic.serverErrors),
    clientErrors: String(traffic.clientErrors),
    rate: String(
      roundPercent(
        (route.issue === "failing"
          ? traffic.serverErrors
          : traffic.clientErrors) / traffic.requests,
      ),
    ),
    average: String(Math.round(averageLatency(traffic))),
    max: String(Math.round(traffic.maxLatency)),
    status: top ? String(top.status) : "",
    message: top?.message ?? "",
    count: top ? String(top.count) : "",
  };
}

function attentionMeta(route: RouteHealth): string[] {
  const top = route.errors.find((group) =>
    route.issue === "failing" ? group.status >= 500 : group.status < 500,
  );
  const key = route.issue!.replace("-", "_");
  const meta = [
    `$api.overview.attention.${key}`,
    `$api.overview.attention.${key}_detail`,
  ];
  if (top?.message) meta.push(`$api.overview.attention.top_error`);
  return meta;
}

function attentionLink(route: RouteHealth): string {
  const ref = routeRef(route.method, route.uri);
  if (route.issue === "failing") return logsLink({ route: ref, tab: "5xx" });
  if (route.issue === "client-errors") {
    return logsLink({ route: ref, tab: "4xx" });
  }
  return logsLink({ route: ref, slow: true });
}

/**
 * Routes that need a look over the last 24 h, worst first, each saying what
 * is wrong in plain words and linking to the requests that show it.
 */
export async function getAttention(
  models: OverviewModels,
  keys: ScopeKeys,
  now: Date = new Date(),
): Promise<{ items: FeedItemPayload[] }> {
  const samples = await loadSamples(models.logs, last24h(now), keys);
  const routes = routesNeedingAttention(computeRouteHealth(samples).values());
  return {
    items: routes.map((route) => ({
      id: route.key,
      ...ISSUE_FEED[route.issue!],
      title: routeRef(route.method, route.uri),
      meta: attentionMeta(route),
      params: attentionParams(route),
      to: attentionLink(route),
    })),
  };
}
