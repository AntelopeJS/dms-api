import { getConfig } from "@/config";
import type { RequestLogSample } from "@/db/models/request_log.model";
import { LATENCY_BUCKETS_MS } from "@/types";
import {
  evaluateHealth,
  HEALTH_THRESHOLDS,
  type HealthEvaluation,
  type HealthVerdict,
  type Incident,
  isSlowShare,
  percentOf,
} from "./health-rules";
import { scopeRouteKey } from "./scope";
import {
  addSample,
  durationOf,
  emptyBucket,
  p95Latency,
  type TrafficBucket,
} from "./traffic";
import type { TimeRange } from "./window";

/**
 * Every route judged by the health rules (`health-rules.ts`), the same rules
 * the API verdict follows, so the Overview, the routes tree and a route's
 * header always agree.
 */

/** Lower bound of each bucket of a latency histogram. */
const BUCKET_LOWER_BOUNDS = [0, ...LATENCY_BUCKETS_MS];

/**
 * What is wrong with a route over the lookback, worst first: failing on its
 * 5xx rate, slow on its p95, or answering many 4xx.
 */
export type RouteIssue = "failing" | "slow" | "client-errors";

/** A route's state in the tree, the header and "Needs attention". */
export type RouteState = RouteIssue | "recovered" | "healthy" | "idle";

/** One error message and how often a route answered it. */
export interface ErrorGroup {
  status: number;
  message: string | null;
  count: number;
  first: Date;
  last: Date;
}

/** A route's traffic over a window, with what went wrong. */
export interface RouteHealth {
  key: string;
  method: string;
  uri: string;
  traffic: TrafficBucket;
  issue: RouteIssue | null;
  /** Error groups, most frequent first. */
  errors: ErrorGroup[];
}

/** A route's health over the lookback: its traffic, its state and why. */
export interface RouteHealthState extends RouteHealth {
  state: RouteState;
  verdict: HealthVerdict;
  incident: Incident | null;
  durationMs: number | null;
  windows: HealthEvaluation["windows"];
  /** p95 of its measured calls over the lookback; null without any. */
  p95Ms: number | null;
  /** Its latest call over the lookback. */
  lastCall: Date;
}

function addError(
  groups: Map<string, ErrorGroup>,
  sample: RequestLogSample,
): void {
  if (sample.statusCode < 400) return;
  const message = sample.errorMessage ?? null;
  const key = `${sample.statusCode}|${message ?? ""}`;
  const at = new Date(sample.timestamp);
  const group = groups.get(key);
  if (!group) {
    groups.set(key, {
      status: sample.statusCode,
      message,
      count: 1,
      first: at,
      last: at,
    });
    return;
  }
  group.count += 1;
  if (at < group.first) group.first = at;
  if (at > group.last) group.last = at;
}

/**
 * The issue a route's traffic over a whole window shows, if any, without the
 * recency the minute-by-minute evaluation adds: rates over at least
 * `minRequests` calls, a p95 (known from the histogram) for slowness.
 */
export function issueOf(
  traffic: TrafficBucket,
  slowThresholdMs: number,
): RouteIssue | null {
  if (traffic.requests < HEALTH_THRESHOLDS.minRequests) return null;
  if (
    traffic.serverErrors > 0 &&
    percentOf(traffic.serverErrors, traffic.requests) >=
      HEALTH_THRESHOLDS.degradedServerErrorRate
  ) {
    return "failing";
  }
  if (slowShareOf(traffic, slowThresholdMs)) return "slow";
  if (
    percentOf(traffic.clientErrors, traffic.requests) >=
    HEALTH_THRESHOLDS.clientErrorRate
  ) {
    return "client-errors";
  }
  return null;
}

/**
 * Whether a bucket's histogram puts its p95 at or above the threshold. The
 * slow calls are those of the buckets starting at or above the threshold:
 * exact when the threshold is one of the bounds, an undercount otherwise.
 */
function slowShareOf(traffic: TrafficBucket, slowThresholdMs: number): boolean {
  let slowCalls = 0;
  let counted = 0;
  traffic.histogram.forEach((count, index) => {
    counted += count;
    if (BUCKET_LOWER_BOUNDS[index] >= slowThresholdMs) slowCalls += count;
  });
  return isSlowShare(slowCalls, counted);
}

/** Sort error groups by count, the most recent first on a tie. */
export function sortErrorGroups(groups: Iterable<ErrorGroup>): ErrorGroup[] {
  return [...groups].sort(
    (a, b) => b.count - a.count || b.last.getTime() - a.last.getTime(),
  );
}

interface RouteGroup {
  key: string;
  method: string;
  uri: string;
  samples: RequestLogSample[];
}

function groupByRoute(samples: RequestLogSample[]): Map<string, RouteGroup> {
  const routes = new Map<string, RouteGroup>();
  for (const sample of samples) {
    const key = scopeRouteKey(sample.method, sample.uri);
    let route = routes.get(key);
    if (!route) {
      route = {
        key,
        method: sample.method.toUpperCase(),
        uri: sample.uri,
        samples: [],
      };
      routes.set(key, route);
    }
    route.samples.push(sample);
  }
  return routes;
}

function summarizeRoute(route: RouteGroup): Omit<RouteHealth, "issue"> {
  const traffic = emptyBucket(0);
  const groups = new Map<string, ErrorGroup>();
  for (const sample of route.samples) {
    addSample(traffic, sample);
    addError(groups, sample);
  }
  return {
    key: route.key,
    method: route.method,
    uri: route.uri,
    traffic,
    errors: sortErrorGroups(groups.values()),
  };
}

/** Per-route traffic, errors and issue of the logged `samples`. */
export function computeRouteHealth(
  samples: RequestLogSample[],
  slowThresholdMs: number = getConfig().requestSlownessThreshold,
): Map<string, RouteHealth> {
  return new Map(
    [...groupByRoute(samples)].map(([key, route]) => {
      const summary = summarizeRoute(route);
      return [
        key,
        { ...summary, issue: issueOf(summary.traffic, slowThresholdMs) },
      ];
    }),
  );
}

function routeStateOf(
  verdict: HealthVerdict,
  traffic: TrafficBucket,
  slowCalls: number,
): RouteState {
  if (verdict === "idle") return "idle";
  if (verdict === "down" || verdict === "degraded") return "failing";
  if (verdict === "recovered") return "recovered";
  if (isSlowShare(slowCalls, traffic.timed)) return "slow";
  if (
    traffic.requests >= HEALTH_THRESHOLDS.minRequests &&
    percentOf(traffic.clientErrors, traffic.requests) >=
      HEALTH_THRESHOLDS.clientErrorRate
  ) {
    return "client-errors";
  }
  return "healthy";
}

/**
 * Every route of `samples` judged by the health rules at the end of
 * `lookback`: whether it fails now or recovered lately (minute by minute,
 * on its 5xx), and over the whole lookback whether it is slow (p95) or
 * answers many 4xx. Without a single 5xx a route can be neither failing nor
 * recovered: it skips the minute-by-minute pass.
 */
export function evaluateRoutes(
  samples: RequestLogSample[],
  lookback: TimeRange,
  slowThresholdMs: number = getConfig().requestSlownessThreshold,
): Map<string, RouteHealthState> {
  const routes = new Map<string, RouteHealthState>();
  for (const [key, route] of groupByRoute(samples)) {
    const summary = summarizeRoute(route);
    const health: HealthEvaluation =
      summary.traffic.serverErrors > 0
        ? evaluateHealth(route.samples, lookback, slowThresholdMs, false)
        : {
            verdict: "operational",
            incident: null,
            durationMs: null,
            windows: null,
          };
    const slowCalls = route.samples.filter((sample) => {
      const ms = durationOf(sample);
      return ms !== null && ms >= slowThresholdMs;
    }).length;
    const state = routeStateOf(health.verdict, summary.traffic, slowCalls);
    routes.set(key, {
      ...summary,
      ...health,
      state,
      issue:
        state === "failing" || state === "slow" || state === "client-errors"
          ? state
          : null,
      p95Ms: p95Latency(summary.traffic),
      lastCall: new Date(
        route.samples.reduce(
          (latest, sample) =>
            Math.max(latest, new Date(sample.timestamp).getTime()),
          0,
        ),
      ),
    });
  }
  return routes;
}

const STATE_RANK: Record<RouteState, number> = {
  failing: 0,
  recovered: 1,
  slow: 2,
  "client-errors": 3,
  healthy: 4,
  idle: 5,
};

function impact(route: RouteHealthState): number {
  switch (route.state) {
    case "failing":
      return (route.verdict === "down" ? 1e12 : 0) + route.traffic.serverErrors;
    case "recovered":
      return route.incident?.end?.getTime() ?? 0;
    case "slow":
      return route.p95Ms ?? 0;
    default:
      return route.traffic.clientErrors;
  }
}

/** A route state "Needs attention" lists: every one but healthy and idle. */
export type AttentionState = Exclude<RouteState, "healthy" | "idle">;

/** Whether `route` is in a state "Needs attention" lists. */
function needsAttention(
  route: RouteHealthState,
): route is RouteHealthState & { state: AttentionState } {
  return route.state !== "healthy" && route.state !== "idle";
}

/**
 * Routes that need a look, worst first: failing (down before degraded, then
 * by how many 5xx), recovered (the latest first), slow (by p95), then those
 * answering many 4xx.
 */
export function routesNeedingAttention(health: Iterable<RouteHealthState>) {
  return [...health]
    .filter(needsAttention)
    .sort(
      (a, b) =>
        STATE_RANK[a.state] - STATE_RANK[b.state] || impact(b) - impact(a),
    );
}
