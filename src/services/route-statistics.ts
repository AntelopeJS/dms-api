import type { GuardFallback } from "@antelopejs/interface-dms/base/guard";
import type { StatGroupItem } from "@antelopejs/interface-dms/base/stat-group";
import type {
  BlockText,
  ComposedText,
  ComposedTextParam,
} from "@antelopejs/interface-dms/base/types/composed-text";
import { getConfig } from "@/config";
import {
  alignComparison,
  comparisonSeriesName,
  noBaselineText,
  shownComparison,
  versusText,
  withVersus,
} from "./comparison";
import { count, percent, text } from "./composed-text";
import { logsLink, testerLink } from "./links";
import type { CatalogModels } from "./route-catalog";
import { computeRouteHealth } from "./route-health";
import { scopeRouteKey } from "./scope";
import {
  averageLatency,
  emptyBucket,
  errorShare,
  loadErrorSamples,
  p95Latency,
  sumBuckets,
  type TrafficBucket,
  windowTraffic,
} from "./traffic";
import {
  describeWindow,
  horizonOf,
  type TimeWindow,
  type WindowInfo,
} from "./window";

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
  /** The headline over the period compared with: the card's "vs" figure. */
  previousValue?: number;
  delta: number | null;
  deltaUnit?: "percent" | "pt";
  series: SeriesPayload[];
  /** The headline measure over the period compared with, drawn dashed. */
  comparisonSeries?: SeriesPayload[];
  window?: WindowInfo;
}

/**
 * A chart of a route nobody called over the period: no series, so the DMS
 * chart shows its empty state rather than a flat 0.
 */
export interface EmptyChartPayload {
  series: [];
}

const EMPTY_CHART: EmptyChartPayload = { series: [] };

/** The latency chart also says where "slow" starts. */
export interface LatencyChartPayload extends RouteChartPayload {
  slowThresholdMs: number;
  /**
   * A y-axis range holding every point and the slow threshold, so the line
   * drawn at the threshold stays in view on a route slower than it.
   */
  yMin: number;
  yMax: number;
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
  /** Its count over the period compared with; absent without one. */
  previous?: number;
}

const PERCENT = 100;
const ONE_DECIMAL = 10;
const TOP_ERRORS_LIMIT = 5;
const SERVER_ERROR = 500;

/**
 * A route's traffic over the window, and over the period it is compared
 * with if there is one, in total and bucket by bucket.
 */
export interface RouteTraffic {
  buckets: TrafficBucket[];
  total: TrafficBucket;
  previous: TrafficBucket | null;
  previousBuckets?: TrafficBucket[] | null;
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
    return {
      buckets: [],
      total: sumBuckets([]),
      previous: null,
      previousBuckets: null,
      window,
    };
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
  const previousBuckets = previous
    ? (previous.routes.get(key) ??
      previous.starts.map((start) => emptyBucket(start)))
    : null;
  return {
    buckets,
    total: sumBuckets(buckets),
    previous: previousBuckets ? sumBuckets(previousBuckets) : null,
    previousBuckets,
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

/**
 * The calls against the period compared with, named after the comparison
 * picked ("+12 % vs. 1,020 last year"); "No data a year back to compare
 * with" when that period is no longer kept; nothing without a comparison.
 */
function callsVersus(
  traffic: RouteTraffic,
): Pick<StatGroupItem, "detail" | "detailTone"> {
  const { window } = traffic;
  if (!window || window.comparison === "none") return {};
  const comparison = shownComparison(window);
  if (!comparison || !traffic.previous) {
    return {
      detail: noBaselineText(window.comparison),
      detailTone: "neutral",
    };
  }
  const before = traffic.previous.requests;
  return {
    detail: versusText(comparison, traffic.total.requests, before, count),
    detailTone: traffic.total.requests >= before ? "success" : "warning",
  };
}

/**
 * A figure of the period against the same over the period compared with:
 * undefined without a comparison, or when the route had nothing to measure
 * then.
 */
function figureVersus(
  traffic: RouteTraffic,
  measure: (bucket: TrafficBucket) => number | null,
  format: (value: number) => ComposedTextParam,
  unit: "percent" | "pt" = "percent",
): ComposedText | undefined {
  const comparison = traffic.window ? shownComparison(traffic.window) : null;
  if (!comparison || !traffic.previous) return undefined;
  const current = measure(traffic.total);
  const before = measure(traffic.previous);
  if (current === null || before === null) return undefined;
  return versusText(comparison, current, before, format, unit);
}

const timedAverage = (bucket: TrafficBucket) =>
  bucket.timed > 0 ? Math.round(averageLatency(bucket)) : null;
const timedMax = (bucket: TrafficBucket) =>
  bucket.timed > 0 ? Math.round(bucket.maxLatency) : null;
const calledErrorRate = (bucket: TrafficBucket) =>
  bucket.requests > 0 ? errorRate(bucket) : null;

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
 * answering a call from its cache. Absent without a measured call.
 */
function p95Detail(total: TrafficBucket, slowThreshold: number) {
  const p95 = p95Latency(total);
  if (p95 === null) {
    return {
      detail: text("routes.statistics.p95_none"),
      detailTone: "neutral" as const,
    };
  }
  return {
    detail: text("routes.statistics.p95_detail", { p95: ms(p95) }),
    detailTone:
      p95 >= slowThreshold ? ("warning" as const) : ("neutral" as const),
  };
}

/**
 * The headline figures of a route over the page's period, as a DMS
 * `StatGroup`: the calls, the average latency with the p95 under it, the
 * error rate split into 4xx and 5xx, and the slowest call against the slow
 * threshold. Under a comparison each figure says its change against the
 * period compared with and what it was then ("+12 % vs. 1,020 previous
 * period", the error rate in points). A duration never measured (a request
 * turned away before any handler) counts as a call, not as a 0 ms one. No
 * call over the period gives no figures, so the StatGroup shows its empty
 * state.
 */
export function routeSummary(
  traffic: RouteTraffic,
  slowThreshold: number,
): RouteSummaryPayload {
  const { total } = traffic;
  if (total.requests === 0) return { items: [] };
  const rate = errorRateFigures(traffic).value;
  const latency = p95Detail(total, slowThreshold);
  const timed = total.timed > 0;
  return {
    items: [
      {
        id: "requests",
        icon: "i-ph-arrows-left-right",
        eyebrow: "$api.routes.statistics.requests",
        value: total.requests,
        ...callsVersus(traffic),
      },
      {
        id: "latency",
        icon: "i-ph-timer",
        eyebrow: "$api.routes.statistics.average",
        value: timed ? ms(averageLatency(total)) : "—",
        ...latency,
        detail: withVersus(
          latency.detail,
          figureVersus(traffic, timedAverage, ms),
        ),
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
        detail: withVersus(
          text("routes.statistics.error_split", {
            client: count(total.clientErrors),
            server: count(total.serverErrors),
          }),
          figureVersus(traffic, calledErrorRate, percent, "pt"),
        ),
        detailTone: total.serverErrors > 0 ? "error" : "neutral",
      },
      {
        id: "max",
        icon: "i-ph-gauge",
        tone: timed && total.maxLatency >= slowThreshold ? "warning" : "muted",
        eyebrow: "$api.routes.statistics.max",
        value: timed ? ms(total.maxLatency) : "—",
        detail: withVersus(
          text("routes.statistics.slow_line", { threshold: ms(slowThreshold) }),
          figureVersus(traffic, timedMax, ms),
        ),
        detailTone:
          timed && total.maxLatency >= slowThreshold ? "warning" : "neutral",
      },
    ],
    window: windowOf(traffic),
  };
}

/**
 * What the Statistics tab's DMS `Guard` reads: the route's calls over the
 * period. Without one, the guard draws a single empty state in place of the
 * tab's blocks, which this answer completes with what only the route knows:
 * whether it was ever called, and the Tester of this very route.
 */
export interface RouteActivityPayload {
  calls: number;
  emptyState?: GuardFallback;
}

export function routeActivity(
  traffic: RouteTraffic,
  route: string | undefined,
  /** When it was last called (ISO), null when never. */
  lastCallAt: string | null,
): RouteActivityPayload {
  const calls = traffic.total.requests;
  if (calls > 0 || !route) return { calls };
  return {
    calls,
    emptyState: {
      ...(!lastCallAt && {
        description: "$api.routes.statistics.idle_never",
      }),
      actions: [
        {
          label: "$api.routes.statistics.idle_try",
          icon: "i-ph-paper-plane-tilt",
          to: testerLink(route),
        },
      ],
    },
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
 * One measure of the route over the period compared with, bucket by bucket
 * on the window's own: the card draws it dashed. None without a comparison.
 */
function comparisonSeries(
  traffic: RouteTraffic,
  pick: (bucket: TrafficBucket) => number | null,
): Pick<RouteChartPayload, "comparisonSeries"> {
  const comparison = traffic.window ? shownComparison(traffic.window) : null;
  if (!comparison || !traffic.previousBuckets) return {};
  return {
    comparisonSeries: [
      {
        name: comparisonSeriesName(comparison),
        data: alignComparison(traffic.buckets, traffic.previousBuckets, pick),
      },
    ],
  };
}

/**
 * Share of 4xx and of 5xx per bucket, in percent, so a few errors stay
 * visible next to a busy day. The delta is in points; under a comparison
 * the error rate of the period compared with is its "vs" figure and a
 * dashed line.
 */
export function errorRateChart(
  traffic: RouteTraffic,
): RouteChartPayload | EmptyChartPayload {
  if (traffic.total.requests === 0) return EMPTY_CHART;
  const share =
    (part: (bucket: TrafficBucket) => number) => (bucket: TrafficBucket) =>
      (part(bucket) / bucket.requests) * PERCENT;
  const { value, delta } = errorRateFigures(traffic);
  const before = traffic.previous ? calledErrorRate(traffic.previous) : null;
  return {
    value,
    ...(before !== null && { previousValue: before }),
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
    ...(before !== null && comparisonSeries(traffic, calledErrorRate)),
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
 * hour is exact; that of a day comes from its latency histogram. Under a
 * comparison the average of the period compared with is the card's "vs"
 * figure, its delta and a dashed line.
 */
export function latencyChart(
  traffic: RouteTraffic,
  slowThresholdMs: number = getConfig().requestSlownessThreshold,
): LatencyChartPayload | EmptyChartPayload {
  if (traffic.total.requests === 0) return EMPTY_CHART;
  const points = (pick: (bucket: TrafficBucket) => number | null) =>
    traffic.buckets.map((bucket) => {
      const value = bucket.timed > 0 ? pick(bucket) : null;
      return { x: bucket.start, y: value === null ? null : Math.round(value) };
    });
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
      name: "$api.routes.statistics.series_p95",
      data: points(p95Latency),
    },
  ];
  const value = Math.round(averageLatency(traffic.total));
  const before = traffic.previous ? timedAverage(traffic.previous) : null;
  const compared =
    before === null ? {} : comparisonSeries(traffic, timedAverage);
  const highest = Math.max(
    slowThresholdMs,
    ...[...series, ...(compared.comparisonSeries ?? [])].flatMap((line) =>
      line.data.map((point) => point.y ?? 0),
    ),
  );
  return {
    value,
    ...(before !== null && { previousValue: before }),
    delta: before === null ? null : change(value, before),
    deltaUnit: "percent",
    series,
    ...compared,
    slowThresholdMs,
    yMin: 0,
    yMax: Math.ceil((highest * Y_HEADROOM) / Y_STEP_MS) * Y_STEP_MS,
    window: windowOf(traffic),
  };
}

/**
 * The route's errors over the period compared with, by group; null without
 * a comparison or when the logs of that period are already pruned (an error
 * count of a pruned period would read "none").
 */
async function previousErrorCounts(
  models: CatalogModels,
  window: TimeWindow,
  key: string,
): Promise<Map<string, number> | null> {
  if (!shownComparison(window) || !window.previous) return null;
  if (window.previous.from < horizonOf("minute", new Date())) return null;
  const errors = await loadErrorSamples(
    models.logs,
    window.previous,
    new Set([key]),
    400,
  );
  const groups = computeRouteHealth(errors).get(key)?.errors ?? [];
  return new Map(groups.map((group) => [errorId(group), group.count]));
}

function errorId(group: { status: number; message: string | null }): string {
  return `${group.status}:${group.message ?? ""}`;
}

/**
 * Why the route fails over the window: its errors grouped by status and
 * message, most frequent first, each linking to its requests in the logs
 * over the same window, and under a comparison its count then ("+200 % vs.
 * 4 previous period").
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
  const before = await previousErrorCounts(models, window, key);
  const comparison = shownComparison(window);
  return {
    items: groups.slice(0, TOP_ERRORS_LIMIT).map((group) => {
      const isServer = group.status >= SERVER_ERROR;
      const id = errorId(group);
      const previous = before ? (before.get(id) ?? 0) : undefined;
      return {
        id,
        title: group.message
          ? `${group.status} · ${group.message}`
          : String(group.status),
        description: withVersus(
          text(
            isServer
              ? "routes.statistics.server_error"
              : "routes.statistics.client_error",
            { at: { type: "relative", value: group.last.toISOString() } },
          ),
          comparison && previous !== undefined
            ? versusText(comparison, group.count, previous, count)
            : undefined,
        ),
        value: group.count,
        icon: isServer ? "i-ph-x-circle" : "i-ph-warning",
        to: logsLink({
          route: ref,
          error: group.message ?? undefined,
          tab: isServer ? "5xx" : "4xx",
          period: window.preset,
          from: "routes",
        }),
        status: group.status,
        message: group.message,
        first: group.first.toISOString(),
        last: group.last.toISOString(),
        ...(previous !== undefined && { previous }),
      };
    }),
    window: info,
  };
}
