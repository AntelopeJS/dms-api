import { getConfig } from "@/config";
import type { RequestLogSample } from "@/db/models/request_log.model";
import { ELEVATED_ERROR_RATE } from "@/types";
import { scopeRouteKey } from "./scope";
import { addSample, averageLatency, type TrafficBucket } from "./traffic";

/**
 * What is wrong with a route, worst first: any 5xx makes it failing, an
 * average above the slow threshold makes it slow, a share of 4xx above
 * {@link ELEVATED_ERROR_RATE} flags its client errors.
 */
export type RouteIssue = "failing" | "slow" | "client-errors";

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

function emptyTraffic(): TrafficBucket {
  return {
    start: 0,
    requests: 0,
    clientErrors: 0,
    serverErrors: 0,
    totalLatency: 0,
    maxLatency: 0,
    minLatency: 0,
  };
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

/** The issue a route's traffic shows, if any. */
export function issueOf(
  traffic: TrafficBucket,
  slowThresholdMs: number,
): RouteIssue | null {
  if (traffic.requests === 0) return null;
  if (traffic.serverErrors > 0) return "failing";
  if (averageLatency(traffic) >= slowThresholdMs) return "slow";
  if (traffic.clientErrors / traffic.requests >= ELEVATED_ERROR_RATE) {
    return "client-errors";
  }
  return null;
}

/** Sort error groups by count, the most recent first on a tie. */
export function sortErrorGroups(groups: Iterable<ErrorGroup>): ErrorGroup[] {
  return [...groups].sort(
    (a, b) => b.count - a.count || b.last.getTime() - a.last.getTime(),
  );
}

/** Per-route health of the logged `samples`. */
export function computeRouteHealth(
  samples: RequestLogSample[],
  slowThresholdMs: number = getConfig().requestSlownessThreshold,
): Map<string, RouteHealth> {
  const routes = new Map<
    string,
    Omit<RouteHealth, "issue" | "errors"> & { groups: Map<string, ErrorGroup> }
  >();
  for (const sample of samples) {
    const key = scopeRouteKey(sample.method, sample.uri);
    let route = routes.get(key);
    if (!route) {
      route = {
        key,
        method: sample.method.toUpperCase(),
        uri: sample.uri,
        traffic: emptyTraffic(),
        groups: new Map(),
      };
      routes.set(key, route);
    }
    addSample(route.traffic, sample);
    addError(route.groups, sample);
  }
  return new Map(
    [...routes].map(([key, { groups, ...route }]) => [
      key,
      {
        ...route,
        issue: issueOf(route.traffic, slowThresholdMs),
        errors: sortErrorGroups(groups.values()),
      },
    ]),
  );
}

const ISSUE_RANK: Record<RouteIssue, number> = {
  failing: 0,
  slow: 1,
  "client-errors": 2,
};

/**
 * Routes with an issue, failing first, then slow, then client errors; within
 * an issue, the one hurting the most traffic first.
 */
export function routesNeedingAttention(
  health: Iterable<RouteHealth>,
): RouteHealth[] {
  return [...health]
    .filter((route) => route.issue !== null)
    .sort((a, b) => {
      const rank = ISSUE_RANK[a.issue!] - ISSUE_RANK[b.issue!];
      if (rank !== 0) return rank;
      const impact = (route: RouteHealth) =>
        route.issue === "slow"
          ? averageLatency(route.traffic)
          : route.traffic.serverErrors * 1000 + route.traffic.clientErrors;
      return impact(b) - impact(a);
    });
}
