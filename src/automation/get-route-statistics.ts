import { GetModel } from "@antelopejs/interface-database-decorators";
import type { ActionType } from "@antelopejs/interface-dms-automation";
import { getConfig } from "@/config";
import { RequestLogModel, RouteStatisticsModel } from "@/db";
import { normalizeRoutePath } from "@/db/tables/routes_statistics.table";
import { routeLink, routeRef } from "@/services/links";
import { findRouteHandler } from "@/services/route-catalog";
import {
  loadRouteTraffic,
  type RouteKey,
  type RouteTraffic,
} from "@/services/route-statistics";
import {
  averageLatency,
  errorShare,
  p95Latency,
  type TrafficBucket,
} from "@/services/traffic";
import {
  resolveWindow,
  type TimeWindow,
  type WindowPreset,
} from "@/services/window";
import {
  DATE_TIME,
  nullable,
  objectSchema,
  PERIOD_INPUT,
  requireRouteRef,
  routeRefInput,
} from "./outputs";
import { refreshSettings } from "./scope";

interface GetRouteStatisticsInput {
  route: string;
  period?: WindowPreset;
  since?: string;
  until?: string;
  compare?: boolean;
}

type PreviousFigures = {
  requests: number;
  errorRate: number;
  averageLatencyMs: number | null;
  p95Ms: number | null;
  from: string;
  to: string;
};

type GetRouteStatisticsOutput = {
  found: boolean;
  route: string;
  requests: number;
  clientErrors: number;
  serverErrors: number;
  errorRate: number;
  averageLatencyMs: number | null;
  p95Ms: number | null;
  maxLatencyMs: number | null;
  timedRequests: number;
  slowThresholdMs: number;
  granularity: string;
  from: string;
  to: string;
  previous: PreviousFigures | null;
  routePath: string;
};

const DEFAULT_PERIOD: WindowPreset = "last-24h";
const PERCENT = 100;

function rounded(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

/** The window a read input names, clamped to what is still stored. */
export function inputWindow(
  input: {
    period?: WindowPreset;
    since?: string;
    until?: string;
    compare?: boolean;
  },
  fallback: WindowPreset,
  now: Date = new Date(),
): TimeWindow {
  const comparison = input.compare === false ? "none" : "previous-period";
  return resolveWindow(
    input.since
      ? { from: input.since, to: input.until, comparison }
      : { preset: input.period ?? fallback, comparison },
    fallback,
    now,
  );
}

function figures(bucket: TrafficBucket) {
  return {
    requests: bucket.requests,
    errorRate: errorShare(bucket) * PERCENT,
    averageLatencyMs: bucket.timed > 0 ? averageLatency(bucket) : null,
    p95Ms: rounded(p95Latency(bucket)),
  };
}

/** What the action reads. */
export interface RouteStatisticsSources {
  refresh: () => Promise<void>;
  traffic: (
    route: RouteKey | undefined,
    window: TimeWindow,
  ) => Promise<RouteTraffic>;
}

const SOURCES: RouteStatisticsSources = {
  refresh: refreshSettings,
  traffic: (route, window) =>
    loadRouteTraffic(
      {
        logs: GetModel(RequestLogModel),
        stats: GetModel(RouteStatisticsModel),
      },
      route,
      window,
    ),
};

/** The action, reading through `sources`. */
export function getRouteStatisticsActionOf(
  sources: RouteStatisticsSources = SOURCES,
): ActionType<GetRouteStatisticsInput, GetRouteStatisticsOutput> {
  return {
    id: "api.get-route-statistics",
    name: "Get route statistics",
    description:
      "A route's calls, error share, average, p95 and max latency over a period, with the previous period",
    icon: "i-ph-chart-line",
    sideEffects: false,
    inputSchema: {
      type: "object",
      properties: {
        route: routeRefInput("METHOD /path of a registered route"),
        period: {
          ...PERIOD_INPUT,
          default: DEFAULT_PERIOD,
          description: "Ignored when since is set",
        },
        since: DATE_TIME,
        until: { ...DATE_TIME, description: "Now by default" },
        compare: {
          type: "boolean",
          default: true,
          description: "Also the period before",
        },
      },
      required: ["route"],
      additionalProperties: false,
    },
    outputSchema: objectSchema({
      found: {
        type: "boolean",
        description: "False when no registered route answers the ref",
      },
      route: { type: "string" },
      requests: { type: "integer" },
      clientErrors: { type: "integer" },
      serverErrors: { type: "integer" },
      errorRate: { type: "number", description: "4xx and 5xx, in percent" },
      averageLatencyMs: nullable("number"),
      p95Ms: nullable("number"),
      maxLatencyMs: nullable("number"),
      timedRequests: { type: "integer" },
      slowThresholdMs: { type: "integer" },
      granularity: { type: "string", enum: ["minute", "hour", "day"] },
      from: DATE_TIME,
      to: DATE_TIME,
      previous: nullable("object", {
        properties: {
          requests: { type: "integer" },
          errorRate: { type: "number" },
          averageLatencyMs: nullable("number"),
          p95Ms: nullable("number"),
          from: DATE_TIME,
          to: DATE_TIME,
        },
      }),
      routePath: { type: "string" },
    }),
    async execute(input) {
      const named = requireRouteRef(input.route);
      await sources.refresh();
      const handler = findRouteHandler(named.ref)?.handler;
      const route = handler
        ? {
            method: handler.method.toUpperCase(),
            path: normalizeRoutePath(handler.location),
          }
        : undefined;
      const ref = route ? routeRef(route.method, route.path) : named.ref;
      const window = inputWindow(input, DEFAULT_PERIOD);
      const traffic = await sources.traffic(route, window);
      const total = figures(traffic.total);
      return {
        found: route !== undefined,
        route: ref,
        ...total,
        clientErrors: traffic.total.clientErrors,
        serverErrors: traffic.total.serverErrors,
        maxLatencyMs: traffic.total.timed > 0 ? traffic.total.maxLatency : null,
        timedRequests: traffic.total.timed,
        slowThresholdMs: getConfig().requestSlownessThreshold,
        granularity: window.granularity,
        from: window.from.toISOString(),
        to: window.to.toISOString(),
        previous:
          traffic.previous && window.previous
            ? {
                ...figures(traffic.previous),
                from: window.previous.from.toISOString(),
                to: window.previous.to.toISOString(),
              }
            : null,
        routePath: routeLink(ref, "statistics"),
      };
    },
  };
}

export const getRouteStatisticsAction = getRouteStatisticsActionOf();
