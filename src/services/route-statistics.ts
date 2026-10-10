import type { StatGroupItem } from "@antelopejs/interface-dms/base/stat-group";
import type {
  BlockText,
  ComposedText,
} from "@antelopejs/interface-dms/base/types/composed-text";
import { logsLink } from "./links";
import type { CatalogModels } from "./route-catalog";
import { computeRouteHealth } from "./route-health";
import { scopeRouteKey } from "./scope";
import {
  averageLatency,
  errorShare,
  loadSamples,
  loadTraffic,
  sumBuckets,
  type TrafficBucket,
} from "./traffic";
import type { TimeWindow } from "./window";

/** The method and path of a route, as `findRoute` resolves them. */
export interface RouteKey {
  method: string;
  path: string;
}

/** One series of a DMS chart: `{ x, y }` points. */
interface SeriesPayload {
  name: string;
  data: Array<{ x: number; y: number }>;
}

/** What a DMS `ChartCard` reads from its `fetchUrl`. */
export interface RouteChartPayload {
  value: number;
  delta: number | null;
  series: SeriesPayload[];
}

/** One row of a DMS `TopListCard`. */
export interface RouteErrorItem {
  id: string;
  title: string;
  description: BlockText;
  value: number;
  icon: string;
  to: string;
}

const PERCENT = 100;
const ONE_DECIMAL = 10;
const TOP_ERRORS_LIMIT = 5;
const SERVER_ERROR = 500;

/** A route's traffic over the window, and over the previous one if asked. */
export interface RouteTraffic {
  buckets: TrafficBucket[];
  total: TrafficBucket;
  previous: TrafficBucket | null;
}

function keysOf(route: RouteKey): Set<string> {
  return new Set([scopeRouteKey(route.method, route.path)]);
}

/**
 * The traffic of a route, bucketed like the page's period. A route the
 * runtime no longer registers has no traffic: its blocks show zeros under the
 * header saying it is gone, rather than an error each.
 */
export async function loadRouteTraffic(
  models: CatalogModels,
  route: RouteKey | undefined,
  window: TimeWindow,
): Promise<RouteTraffic> {
  if (!route) {
    const empty = sumBuckets([]);
    return { buckets: [], total: empty, previous: null };
  }
  const keys = keysOf(route);
  const [buckets, previous] = await Promise.all([
    loadTraffic(models, window, window.granularity, keys),
    window.previous
      ? loadTraffic(models, window.previous, window.granularity, keys)
      : Promise.resolve(null),
  ]);
  return {
    buckets,
    total: sumBuckets(buckets),
    previous: previous ? sumBuckets(previous) : null,
  };
}

function change(current: number, previous: number | undefined): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * PERCENT;
}

/** Share of 4xx and 5xx, in percent with one decimal. */
function errorRate(bucket: TrafficBucket): number {
  return Math.round(errorShare(bucket) * PERCENT * ONE_DECIMAL) / ONE_DECIMAL;
}

function busy(buckets: TrafficBucket[]): TrafficBucket[] {
  return buckets.filter((bucket) => bucket.requests > 0);
}

function ms(value: number): ComposedText {
  return {
    key: "api.routes.statistics.ms",
    params: { value: { type: "number", value: Math.round(value) } },
  };
}

function versus(delta: number | null): BlockText {
  if (delta === null) return "$api.routes.statistics.no_baseline";
  return {
    key: "api.routes.statistics.vs_previous",
    params: {
      delta: { type: "number", value: delta / PERCENT, format: "percent" },
    },
  };
}

/**
 * The headline figures of a route over the page's period, as a DMS
 * `StatGroup`: calls against the previous period, latency, error rate and
 * the slowest call against the slow threshold.
 */
export function routeSummary(
  traffic: RouteTraffic,
  slowThreshold: number,
): { items: StatGroupItem[] } {
  const { total } = traffic;
  const delta = change(total.requests, traffic.previous?.requests);
  const rate = errorRate(total);
  return {
    items: [
      {
        id: "requests",
        icon: "i-ph-arrows-left-right",
        eyebrow: "$api.routes.statistics.requests",
        value: total.requests,
        detail: versus(delta),
        detailTone:
          delta === null ? "neutral" : delta >= 0 ? "success" : "warning",
      },
      {
        id: "latency",
        icon: "i-ph-timer",
        eyebrow: "$api.routes.statistics.average",
        value: ms(averageLatency(total)),
        detail: {
          key: "api.routes.statistics.min",
          params: { min: ms(total.minLatency) },
        },
      },
      {
        id: "errors",
        icon: "i-ph-warning-diamond",
        tone: rate > 0 ? "warning" : "muted",
        eyebrow: "$api.routes.statistics.error_rate",
        value: {
          key: "api.routes.statistics.rate",
          params: {
            rate: { type: "number", value: rate / PERCENT, format: "percent" },
          },
        },
        detail: {
          key: "api.routes.statistics.error_split",
          params: { client: total.clientErrors, server: total.serverErrors },
        },
        detailTone: total.serverErrors > 0 ? "error" : "neutral",
      },
      {
        id: "max",
        icon: "i-ph-gauge",
        tone: total.maxLatency >= slowThreshold ? "warning" : "muted",
        eyebrow: "$api.routes.statistics.max",
        value: ms(total.maxLatency),
        detail: {
          key: "api.routes.statistics.slow_line",
          params: { threshold: ms(slowThreshold) },
        },
        detailTone: total.maxLatency >= slowThreshold ? "warning" : "neutral",
      },
    ],
  };
}

/** Requests per bucket, split by status class. */
export function statusChart(traffic: RouteTraffic): RouteChartPayload {
  const points = (pick: (bucket: TrafficBucket) => number) =>
    traffic.buckets.map((bucket) => ({ x: bucket.start, y: pick(bucket) }));
  return {
    value: traffic.total.requests,
    delta: change(traffic.total.requests, traffic.previous?.requests),
    series: [
      {
        name: "2xx",
        data: points(
          (bucket) =>
            bucket.requests - bucket.clientErrors - bucket.serverErrors,
        ),
      },
      { name: "4xx", data: points((bucket) => bucket.clientErrors) },
      { name: "5xx", data: points((bucket) => bucket.serverErrors) },
    ],
  };
}

/** Average, max and min latency of the buckets that saw a call. */
export function latencyChart(traffic: RouteTraffic): RouteChartPayload {
  const buckets = busy(traffic.buckets);
  const points = (pick: (bucket: TrafficBucket) => number) =>
    buckets.map((bucket) => ({
      x: bucket.start,
      y: Math.round(pick(bucket)),
    }));
  return {
    value: Math.round(averageLatency(traffic.total)),
    delta: null,
    series: [
      {
        name: "$api.routes.statistics.series_average",
        data: points(averageLatency),
      },
      {
        name: "$api.routes.statistics.series_max",
        data: points((bucket) => bucket.maxLatency),
      },
      {
        name: "$api.routes.statistics.series_min",
        data: points((bucket) => bucket.minLatency),
      },
    ],
  };
}

/**
 * Why the route fails over the window: its errors grouped by status and
 * message, most frequent first, each linking to its requests in the logs.
 */
export async function routeTopErrors(
  models: CatalogModels,
  route: RouteKey | undefined,
  window: TimeWindow,
  ref: string,
): Promise<{ items: RouteErrorItem[] }> {
  if (!route) return { items: [] };
  const key = scopeRouteKey(route.method, route.path);
  const samples = await loadSamples(models.logs, window, new Set([key]));
  const errors = computeRouteHealth(samples).get(key)?.errors ?? [];
  return {
    items: errors.slice(0, TOP_ERRORS_LIMIT).map((group) => {
      const isServer = group.status >= SERVER_ERROR;
      return {
        id: `${group.status}:${group.message ?? ""}`,
        title: group.message
          ? `${group.status} · ${group.message}`
          : String(group.status),
        description: {
          key: isServer
            ? "api.routes.statistics.server_error"
            : "api.routes.statistics.client_error",
          params: { at: { type: "relative", value: group.last.toISOString() } },
        },
        value: group.count,
        icon: isServer ? "i-ph-x-circle" : "i-ph-warning",
        to: logsLink({
          route: ref,
          error: group.message ?? undefined,
          tab: isServer ? "5xx" : "4xx",
        }),
      };
    }),
  };
}
