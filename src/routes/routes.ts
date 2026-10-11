import {
  Context,
  Controller,
  Get,
  Parameter,
  type RequestContext,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { AuthUserWithPermission } from "@antelopejs/interface-dms/guards";
import { getConfig } from "@/config";
import { RequestLogModel, RouteModel, RouteStatisticsModel } from "@/db";
import { normalizeRoutePath } from "@/db/tables/routes_statistics.table";
import { RoutesPage } from "@/pages/routes";
import { apiOriginOf } from "@/services/api-origin";
import { isInternalTraffic } from "@/services/request-log/capture";
import { loadRouteHealth } from "@/services/overview";
import {
  type CatalogModels,
  findRoute,
  getRouteDetail,
  listRoutes,
} from "@/services/route-catalog";
import { HEALTH_THRESHOLDS } from "@/services/health-rules";
import {
  errorRateChart,
  type EmptyChartPayload,
  type LatencyChartPayload,
  latencyChart,
  loadRouteTraffic,
  routeSummary,
  type RouteChartPayload,
  type RouteSummaryPayload,
  type RouteTraffic,
  routeTopErrors,
} from "@/services/route-statistics";
import { getScopedRouteKeys, scopeRouteKey } from "@/services/scope";
import { getActiveScope } from "@/services/settings";
import { loadRollups } from "@/services/traffic";
import {
  DEFAULT_WINDOW,
  resolveWindow,
  type TimeWindow,
  windowQueryFrom,
} from "@/services/window";

const ROUTE_NOT_FOUND = "Route not found";

function models(): CatalogModels {
  return {
    logs: GetModel(RequestLogModel),
    stats: GetModel(RouteStatisticsModel),
    routes: GetModel(RouteModel),
  };
}

const explorer = RoutesPage.explorer;
const statistics = ["tabs", "statistics"] as const;

function windowOf(context: RequestContext): TimeWindow {
  return resolveWindow(
    windowQueryFrom(context.url.searchParams),
    DEFAULT_WINDOW,
  );
}

/** The route `?route=` names, if the runtime still registers it. */
function routeOf(context: RequestContext) {
  const inspection = findRoute(
    context.url.searchParams.get("route") ?? undefined,
  );
  return inspection
    ? { method: inspection.method.toUpperCase(), path: inspection.location }
    : undefined;
}

function trafficOf(context: RequestContext): Promise<RouteTraffic> {
  return loadRouteTraffic(models(), routeOf(context), windowOf(context));
}

/**
 * The first day each route was called, from the day rollups: the oldest
 * kept, so never further back than the statistics retention.
 */
async function firstCalls(): Promise<Map<string, string>> {
  const first = new Map<string, string>();
  for (const route of await loadRollups(GetModel(RouteStatisticsModel))) {
    const days = route.statistics
      .filter((day) => day.requestsCount > 0)
      .map((day) => day.day);
    if (days.length > 0) {
      first.set(
        scopeRouteKey(route.method, route.uri),
        new Date(Math.min(...days)).toISOString(),
      );
    }
  }
  return first;
}

/**
 * Every route's health by the rules the Overview applies, over the same last
 * 24 h, with the first day it was called: what the tree and the header show
 * next to a route.
 */
async function routeHealth() {
  const [{ lookback, routes }, first] = await Promise.all([
    loadRouteHealth(models()),
    firstCalls(),
  ]);
  const healthWindow = {
    from: lookback.from.toISOString(),
    to: lookback.to.toISOString(),
    minutes: HEALTH_THRESHOLDS.lookbackMinutes,
  };
  const of = (method: string, path: string) => {
    const key = scopeRouteKey(method, path);
    const health = routes.get(key);
    return {
      requests: health?.traffic.requests ?? 0,
      state: health?.state ?? ("idle" as const),
      verdict: health?.verdict ?? ("idle" as const),
      incident: health?.incident
        ? {
            start: health.incident.start?.toISOString() ?? null,
            end: health.incident.end?.toISOString() ?? null,
          }
        : null,
      p95Ms: health?.p95Ms ?? null,
      firstCallAt: first.get(key) ?? null,
      lastCallAt: health?.lastCall.toISOString() ?? null,
    };
  };
  return { healthWindow, of };
}

/**
 * The latest call of a route older than the health lookback, the Tester's
 * aside. By the route's method: a HEAD its GET handler served counts.
 */
async function lastCallBefore(method: string, path: string) {
  const { results } = await GetModel(RequestLogModel).query({
    routeMethod: method,
    uri: normalizeRoutePath(path),
    apiTrafficOnly: true,
    limit: 1,
  });
  return results[0]?.timestamp.toISOString() ?? null;
}

/**
 * The Routes page's blocks: the tree, then everything about the route the
 * URL names (`?route=METHOD%20/path`). A route is named by its method and
 * path, never by the runtime's route id, which changes on every start. The
 * Statistics blocks follow the page's window; a route's state, in the tree
 * as in the header, is the one the Overview gives it over the last 24 h.
 */
export class RoutesController extends Controller("/api/monitoring/routes") {
  @Get("list")
  async listRoutes(
    @AuthUserWithPermission(explorer.targetChild("tree")) _user: User,
  ) {
    const keys = await getScopedRouteKeys(
      GetModel(RouteModel),
      getActiveScope(),
    );
    const health = await routeHealth();
    return {
      routes: listRoutes(keys).map((row) => ({
        ...row,
        ...health.of(row.method, row.path),
      })),
      healthWindowMinutes: HEALTH_THRESHOLDS.lookbackMinutes,
      requestsWindowMinutes: HEALTH_THRESHOLDS.lookbackMinutes,
      healthWindow: health.healthWindow,
      thresholds: HEALTH_THRESHOLDS,
    };
  }

  /**
   * Read by every block of the explorer around the selected route (the
   * header, the tabs, the layout): guarded by the explorer itself.
   */
  @Get("detail")
  async getDetail(
    @AuthUserWithPermission(explorer)
    _user: User,
    @Context() context: RequestContext,
    @Parameter("route", "query") route?: string,
  ) {
    const [detail, health, keys] = await Promise.all([
      route ? getRouteDetail(models(), route, apiOriginOf(context)) : undefined,
      routeHealth(),
      getScopedRouteKeys(GetModel(RouteModel), getActiveScope()),
    ]);
    assert(detail, 404, ROUTE_NOT_FOUND);
    const { requests, ...state } = health.of(detail.method, detail.path);
    return {
      ...detail,
      ...state,
      lastCallAt:
        state.lastCallAt ?? (await lastCallBefore(detail.method, detail.path)),
      inScope: !keys || keys.has(scopeRouteKey(detail.method, detail.path)),
      // The console's own routes are never logged: no Captured tab for them.
      captured: !isInternalTraffic(detail.path),
      requests24h: requests,
      healthWindowMinutes: HEALTH_THRESHOLDS.lookbackMinutes,
      healthWindow: health.healthWindow,
      thresholds: HEALTH_THRESHOLDS,
    };
  }

  @Get("statistics/summary")
  async getSummary(
    @AuthUserWithPermission(
      explorer.targetChild(...statistics, "summary", "summary"),
    )
    _user: User,
    @Context() context: RequestContext,
  ): Promise<RouteSummaryPayload> {
    return routeSummary(
      await trafficOf(context),
      getConfig().requestSlownessThreshold,
    );
  }

  /** The 4xx and 5xx rates per bucket, in percent. */
  @Get("statistics/status")
  async getStatusChart(
    @AuthUserWithPermission(
      explorer.targetChild(...statistics, "charts", "status"),
    )
    _user: User,
    @Context() context: RequestContext,
  ): Promise<RouteChartPayload | EmptyChartPayload> {
    return errorRateChart(await trafficOf(context));
  }

  @Get("statistics/latency-chart")
  async getLatencyChart(
    @AuthUserWithPermission(
      explorer.targetChild(...statistics, "charts", "latency"),
    )
    _user: User,
    @Context() context: RequestContext,
  ): Promise<LatencyChartPayload | EmptyChartPayload> {
    return latencyChart(await trafficOf(context));
  }

  @Get("statistics/errors")
  async getErrors(
    @AuthUserWithPermission(
      explorer.targetChild(...statistics, "detail", "errors"),
    )
    _user: User,
    @Context() context: RequestContext,
  ) {
    return routeTopErrors(
      models(),
      routeOf(context),
      windowOf(context),
      context.url.searchParams.get("route") ?? "",
    );
  }
}
