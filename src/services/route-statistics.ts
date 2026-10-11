import type { StatGroupItem } from "@antelopejs/interface-dms/base/stat-group";
import type {
  BlockText,
  ComposedText,
} from "@antelopejs/interface-dms/base/types/composed-text";
import { getConfig } from "@/config";
import { logsLink } from "./links";
import type { CatalogModels } from "./route-catalog";
import { computeRouteHealth } from "./route-health";
import { scopeRouteKey } from "./scope";
import {
  averageLatency,
  emptyBucket,
  errorShare,
  loadErrorSamples,
  p95Coverage,
  p95Latency,
  sumBuckets,
  timedOf,
  type TrafficBucket,
  windowTraffic,
} from "./traffic";
import { describeWindow, type TimeWindow, type WindowInfo } from "./window";

/** The method and path of a route, as `findRoute` resolves them. */
export interface RouteKey {
  method: string;
  path: string;
}

/** What a DMS `StatGroup` reads from its `fetchUrl`, and the window it covers. */
export interface RouteSummaryPayload {
  items: StatGroupItem[];
  window?: WindowInfo;
}

/** One series of a DMS chart: `{ x, y }` points, `y: null` for a gap. */
interface SeriesPayload {
  name: string;
  data: Array<{ x: number; y: number | null }>;
}

/** What a DMS `ChartCard` reads from its `fetchUrl`. */
export interface RouteChartPayload {
  value: number;
  delta: number | null;
  deltaUnit?: "percent" | "pt";
  series: SeriesPayload[];
  window?: WindowInfo;
}

/** The latency chart also says where "slow" starts. */
export interface LatencyChartPayload extends RouteChartPayload {
  slowThresholdMs: number;
  /**
   * A y-axis range holding every point and the slow threshold, so the line
   * drawn at the threshold stays in view on a route slower than it.
   */
  yMin: number;
  yMax: number;
  /**
   * Share (0-1) of the window's measured calls the p95 series reads: below
   * 1 when older days kept no latency histogram (their points are gaps), 0
   * when the series is all gaps.
   */
  p95Coverage: number;
}

/** One row of a DMS `TopListCard`. */
export interface RouteErrorItem {
  id: string;
  title: string;
  description: BlockText;
  value: number;
  icon: string;
  to: string;
  status: number;
  message: string | null;
  first: string;
  last: string;
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
  window?: TimeWindow;
}

/**
 * The traffic of a route, bucketed like the page's period. Every block of
 * the Statistics tab reads it: it comes out of the per-route traffic of the
 * window, computed once for all routes and cached. A route the runtime no
 * longer registers has no traffic: its blocks show zeros under the header
 * saying it is gone, rather than an error each.
 */
export async function loadRouteTraffic(
  models: CatalogModels,
  route: RouteKey | undefined,
  window: TimeWindow,
): Promise<RouteTraffic> {
  if (!route) {
    return { buckets: [], total: sumBuckets([]), previous: null, window };
  }
  const key = scopeRouteKey(route.method, route.path);
  const [current, previous] = await Promise.all([
    windowTraffic(models, window, window.granularity),
    window.previous
      ? windowTraffic(models, window.previous, window.granularity)
      : Promise.resolve(null),
  ]);
  const buckets =
    current.routes.get(key) ??
    current.starts.map((start) => emptyBucket(start));
  return {
    buckets,
    total: sumBuckets(buckets),
    previous: previous ? sumBuckets(previous.routes.get(key) ?? []) : null,
    window,
  };
}

function change(current: number, previous: number | undefined): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * PERCENT;
}

function roundOne(value: number): number {
  return Math.round(value * ONE_DECIMAL) / ONE_DECIMAL;
}

/** Share of 4xx and 5xx, in percent with one decimal. */
function errorRate(bucket: TrafficBucket): number {
  return roundOne(errorShare(bucket) * PERCENT);
}

function windowOf(traffic: RouteTraffic): WindowInfo | undefined {
  return traffic.window ? describeWindow(traffic.window) : undefined;
}

/** "120 ms", composed in the reader's language. */
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
 * Share of 4xx and 5xx over the window, and its change against the previous
 * window in points: from 2 % to 3 % is "+1 pt", not "+50 %".
 */
function errorRateFigures(traffic: RouteTraffic): {
  value: number;
  delta: number | null;
} {
  const value = errorRate(traffic.total);
  const previous = traffic.previous?.requests
    ? errorRate(traffic.previous)
    : undefined;
  return {
    value,
    delta: previous === undefined ? null : roundOne(value - previous),
  };
}

/**
 * The p95 under the average: the minimum it replaces read 0 ms on any route
 * answering a call from its cache. Said partial when older days kept no
 * latency histogram, and absent when none did.
 */
function p95Detail(total: TrafficBucket, slowThreshold: number) {
  const p95 = p95Latency(total);
  if (p95 === null) {
    return {
      detail: "$api.routes.statistics.p95_none",
      detailTone: "neutral" as const,
    };
  }
  const partial = p95Coverage(total) < 1;
  return {
    detail: {
      key: partial
        ? "api.routes.statistics.p95_partial_detail"
        : "api.routes.statistics.p95_detail",
      params: { p95: ms(p95) },
    },
    detailTone:
      p95 >= slowThreshold ? ("warning" as const) : ("neutral" as const),
  };
}

/**
 * The headline figures of a route over the page's period, as a DMS
 * `StatGroup`: calls against the previous period, the average latency with
 * the p95 under it, the error rate split into 4xx and 5xx, and the slowest
 * call against the slow threshold. A duration never measured (a request
 * turned away before any handler) counts as a call, not as a 0 ms one.
 */
export function routeSummary(
  traffic: RouteTraffic,
  slowThreshold: number,
): RouteSummaryPayload {
  const { total } = traffic;
  const delta = change(total.requests, traffic.previous?.requests);
  const rate = errorRateFigures(traffic).value;
  const timed = timedOf(total) > 0;
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
        value: timed ? ms(averageLatency(total)) : "—",
        ...p95Detail(total, slowThreshold),
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
          params: {
            client: { type: "count", value: total.clientErrors },
            server: { type: "count", value: total.serverErrors },
          },
        },
        detailTone: total.serverErrors > 0 ? "error" : "neutral",
      },
      {
        id: "max",
        icon: "i-ph-gauge",
        tone: timed && total.maxLatency >= slowThreshold ? "warning" : "muted",
        eyebrow: "$api.routes.statistics.max",
        value: timed ? ms(total.maxLatency) : "—",
        detail: {
          key: "api.routes.statistics.slow_line",
          params: { threshold: ms(slowThreshold) },
        },
        detailTone:
          timed && total.maxLatency >= slowThreshold ? "warning" : "neutral",
      },
    ],
    window: windowOf(traffic),
  };
}

/** `pick` of a bucket, or a gap when nobody called the route then. */
function gapPoints(
  buckets: TrafficBucket[],
  pick: (bucket: TrafficBucket) => number | null,
) {
  return buckets.map((bucket) => {
    const value = bucket.requests > 0 ? pick(bucket) : null;
    return { x: bucket.start, y: value === null ? null : roundOne(value) };
  });
}

/**
 * Share of 4xx and of 5xx per bucket, in percent, so a few errors stay
 * visible next to a busy day. The delta is in points.
 */
export function errorRateChart(traffic: RouteTraffic): RouteChartPayload {
  const share =
    (part: (bucket: TrafficBucket) => number) => (bucket: TrafficBucket) =>
      (part(bucket) / bucket.requests) * PERCENT;
  const { value, delta } = errorRateFigures(traffic);
  return {
    value,
    delta,
    deltaUnit: "pt",
    series: [
      {
        name: "4xx",
        data: gapPoints(
          traffic.buckets,
          share((bucket) => bucket.clientErrors),
        ),
      },
      {
        name: "5xx",
        data: gapPoints(
          traffic.buckets,
          share((bucket) => bucket.serverErrors),
        ),
      },
    ],
    window: windowOf(traffic),
  };
}

/** Headroom above the highest point or the threshold, and its rounding step. */
const Y_HEADROOM = 1.1;
const Y_STEP_MS = 100;

/**
 * Average, max and p95 latency per bucket (in that order), a gap where the
 * route was not called or no duration was measured, and the slow threshold
 * the chart draws its line at, with an axis range holding it. The p95 of an
 * hour is exact; that of a day comes from its latency histogram, absent on
 * days written before it existed (a gap, `p95Coverage` below 1, and a p95
 * series named partial).
 */
export function latencyChart(
  traffic: RouteTraffic,
  slowThresholdMs: number = getConfig().requestSlownessThreshold,
): LatencyChartPayload {
  // A bucket without a measured duration is a gap, not a 0 ms point.
  const points = (pick: (bucket: TrafficBucket) => number | null) =>
    traffic.buckets.map((bucket) => {
      const value = timedOf(bucket) > 0 ? pick(bucket) : null;
      return { x: bucket.start, y: value === null ? null : Math.round(value) };
    });
  const coverage = Math.round(p95Coverage(traffic.total) * PERCENT) / PERCENT;
  const partial = coverage < 1 && timedOf(traffic.total) > 0;
  const series = [
    {
      name: "$api.routes.statistics.series_average",
      data: points(averageLatency),
    },
    {
      name: "$api.routes.statistics.series_max",
      data: points((bucket) => bucket.maxLatency),
    },
    {
      name: partial
        ? "$api.routes.statistics.series_p95_partial"
        : "$api.routes.statistics.series_p95",
      data: points(p95Latency),
    },
  ];
  const highest = Math.max(
    slowThresholdMs,
    ...series.flatMap((line) => line.data.map((point) => point.y ?? 0)),
  );
  return {
    value: Math.round(averageLatency(traffic.total)),
    delta: null,
    series,
    slowThresholdMs,
    yMin: 0,
    yMax: Math.ceil((highest * Y_HEADROOM) / Y_STEP_MS) * Y_STEP_MS,
    p95Coverage: coverage,
    window: windowOf(traffic),
  };
}

/**
 * Why the route fails over the window: its errors grouped by status and
 * message, most frequent first, each linking to its requests in the logs
 * over the same window.
 */
export async function routeTopErrors(
  models: CatalogModels,
  route: RouteKey | undefined,
  window: TimeWindow,
  ref: string,
): Promise<{ items: RouteErrorItem[]; window: WindowInfo }> {
  const info = describeWindow(window);
  if (!route) return { items: [], window: info };
  const key = scopeRouteKey(route.method, route.path);
  const errors = await loadErrorSamples(
    models.logs,
    window,
    new Set([key]),
    400,
  );
  const groups = computeRouteHealth(errors).get(key)?.errors ?? [];
  return {
    items: groups.slice(0, TOP_ERRORS_LIMIT).map((group) => {
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
          window: window.preset,
          from: "routes",
        }),
        status: group.status,
        message: group.message,
        first: group.first.toISOString(),
        last: group.last.toISOString(),
      };
    }),
    window: info,
  };
}
