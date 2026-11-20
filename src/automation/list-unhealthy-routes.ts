import { GetModel } from "@antelopejs/interface-database-decorators";
import type { ActionType } from "@antelopejs/interface-dms-automation";
import { RequestLogModel } from "@/db";
import { routeLink, routeRef } from "@/services/links";
import { inScopeRoutes, loadRouteHealth } from "@/services/overview";
import {
  type RouteHealthState,
  routesNeedingAttention,
} from "@/services/route-health";
import {
  ROUTE_FLAGS,
  type RouteFlag,
  routeFlag,
} from "@/services/statistics-aggregate";
import { averageLatency, errorShare } from "@/services/traffic";
import {
  DATE_TIME,
  nullable,
  objectSchema,
  truncateMessage,
  VERDICTS,
} from "./outputs";
import { activeScopeKeys } from "./scope";

interface ListUnhealthyRoutesInput {
  flags?: RouteFlag[];
  includeRecovered?: boolean;
  limit?: number;
}

type UnhealthyRoute = {
  routeKey: string;
  route: string;
  method: string;
  uri: string;
  flag: RouteFlag | null;
  state: string;
  verdict: string;
  requestsLast24h: number;
  serverErrors: number;
  clientErrors: number;
  errorRate: number;
  averageLatencyMs: number;
  p95Ms: number | null;
  incidentStart: string | null;
  incidentEnd: string | null;
  topErrorStatus: number | null;
  topErrorMessage: string | null;
  topErrorCount: number | null;
  routePath: string;
};

type ListUnhealthyRoutesOutput = {
  routes: UnhealthyRoute[];
  total: number;
  checkedAt: string;
};

const DEFAULT_LIMIT = 50;

export function unhealthyRoute(route: RouteHealthState): UnhealthyRoute {
  const ref = routeRef(route.method, route.uri);
  const top = route.errors[0];
  return {
    routeKey: route.key,
    route: ref,
    method: route.method,
    uri: route.uri,
    flag: routeFlag(route.state),
    state: route.state,
    verdict: route.verdict,
    requestsLast24h: route.traffic.requests,
    serverErrors: route.traffic.serverErrors,
    clientErrors: route.traffic.clientErrors,
    errorRate: errorShare(route.traffic),
    averageLatencyMs: averageLatency(route.traffic),
    p95Ms: route.p95Ms,
    incidentStart: route.incident?.start?.toISOString() ?? null,
    incidentEnd: route.incident?.end?.toISOString() ?? null,
    topErrorStatus: top?.status ?? null,
    topErrorMessage: truncateMessage(top?.message),
    topErrorCount: top?.count ?? null,
    routePath: routeLink(ref),
  };
}

/** The routes in bad state among `routes`, worst first, as the input filters them. */
export function unhealthyRoutes(
  routes: RouteHealthState[],
  input: ListUnhealthyRoutesInput,
): UnhealthyRoute[] {
  const flags = new Set<RouteFlag>(input.flags ?? ROUTE_FLAGS);
  return routesNeedingAttention(routes)
    .filter((route) => {
      const flag = routeFlag(route.state);
      return flag ? flags.has(flag) : input.includeRecovered === true;
    })
    .map(unhealthyRoute);
}

export const listUnhealthyRoutesAction: ActionType<
  ListUnhealthyRoutesInput,
  ListUnhealthyRoutesOutput
> = {
  id: "api.list-unhealthy-routes",
  name: "List unhealthy routes",
  description:
    "Routes in a bad state by the API health rules, worst first, for digests",
  icon: "i-ph-list-checks",
  sideEffects: false,
  inputSchema: {
    type: "object",
    properties: {
      flags: {
        type: "array",
        items: { type: "string", enum: [...ROUTE_FLAGS] },
        default: [...ROUTE_FLAGS],
        uniqueItems: true,
      },
      includeRecovered: {
        type: "boolean",
        default: false,
        description: "Also routes whose 5xx run ended less than 15 min ago",
      },
      limit: {
        type: "integer",
        default: DEFAULT_LIMIT,
        minimum: 1,
        maximum: 200,
      },
    },
    additionalProperties: false,
  },
  outputSchema: objectSchema({
    routes: {
      type: "array",
      items: objectSchema({
        routeKey: { type: "string" },
        route: { type: "string" },
        method: { type: "string" },
        uri: { type: "string" },
        flag: nullable("string", { enum: [...ROUTE_FLAGS, null] }),
        state: {
          type: "string",
          enum: ["failing", "slow", "client-errors", "recovered"],
        },
        verdict: { type: "string", enum: [...VERDICTS] },
        requestsLast24h: { type: "integer" },
        serverErrors: { type: "integer" },
        clientErrors: { type: "integer" },
        errorRate: { type: "number", minimum: 0, maximum: 1 },
        averageLatencyMs: { type: "number" },
        p95Ms: nullable("number"),
        incidentStart: nullable("string", { format: "date-time" }),
        incidentEnd: nullable("string", { format: "date-time" }),
        topErrorStatus: nullable("integer"),
        topErrorMessage: nullable("string"),
        topErrorCount: nullable("integer"),
        routePath: { type: "string" },
      }),
    },
    total: { type: "integer", description: "Before the limit" },
    checkedAt: DATE_TIME,
  }),
  async execute(input) {
    const keys = await activeScopeKeys();
    const checkedAt = new Date();
    const { routes } = await loadRouteHealth(
      { logs: GetModel(RequestLogModel) },
      checkedAt,
    );
    const listed = unhealthyRoutes(inScopeRoutes(routes, keys), input);
    return {
      routes: listed.slice(0, input.limit ?? DEFAULT_LIMIT),
      total: listed.length,
      checkedAt: checkedAt.toISOString(),
    };
  },
};
