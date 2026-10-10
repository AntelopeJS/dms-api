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
import { RoutesPage } from "@/pages/routes";
import {
  type CatalogModels,
  findRoute,
  getRouteDetail,
  listRoutes,
} from "@/services/route-catalog";
import {
  latencyChart,
  loadRouteTraffic,
  routeSummary,
  type RouteChartPayload,
  type RouteTraffic,
  routeTopErrors,
  statusChart,
} from "@/services/route-statistics";
import { getScopedRouteKeys } from "@/services/scope";
import { getActiveScope } from "@/services/settings";
import { resolveWindow, type TimeWindow } from "@/services/window";

const DEFAULT_WINDOW_DAYS = 7;
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
  const params = context.url.searchParams;
  return resolveWindow(
    {
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      comparison: params.get("comparison") ?? undefined,
    },
    DEFAULT_WINDOW_DAYS,
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
 * The Routes page's blocks: the tree, then everything about the route the
 * URL names (`?route=METHOD%20/path`). A route is named by its method and
 * path, never by the runtime's route id, which changes on every start.
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
    return { routes: await listRoutes(models(), keys) };
  }

  @Get("detail")
  async getDetail(
    @AuthUserWithPermission(explorer.targetChild("header"))
    _user: User,
    @Parameter("route", "query") route?: string,
  ) {
    const detail = route ? await getRouteDetail(models(), route) : undefined;
    assert(detail, 404, ROUTE_NOT_FOUND);
    return detail;
  }

  @Get("statistics/summary")
  async getSummary(
    @AuthUserWithPermission(
      explorer.targetChild(...statistics, "summary", "summary"),
    )
    _user: User,
    @Context() context: RequestContext,
  ) {
    return routeSummary(
      await trafficOf(context),
      getConfig().requestSlownessThreshold,
    );
  }

  @Get("statistics/status")
  async getStatusChart(
    @AuthUserWithPermission(
      explorer.targetChild(...statistics, "charts", "status"),
    )
    _user: User,
    @Context() context: RequestContext,
  ): Promise<RouteChartPayload> {
    return statusChart(await trafficOf(context));
  }

  @Get("statistics/latency-chart")
  async getLatencyChart(
    @AuthUserWithPermission(
      explorer.targetChild(...statistics, "charts", "latency"),
    )
    _user: User,
    @Context() context: RequestContext,
  ): Promise<RouteChartPayload> {
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
