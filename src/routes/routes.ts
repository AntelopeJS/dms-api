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
import { RequestLogModel, RouteModel, RouteStatisticsModel } from "@/db";
import { RoutesPage } from "@/pages/routes";
import {
  type CatalogModels,
  findRoute,
  getRouteDetail,
  getRouteStatistics,
  listRoutes,
} from "@/services/route-catalog";
import { getScopedRouteKeys } from "@/services/scope";
import { getActiveScope } from "@/services/settings";
import { resolveWindow } from "@/services/window";

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
const tabs = ["tabs"] as const;

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

  @Get("statistics")
  async getStatistics(
    @AuthUserWithPermission(explorer.targetChild(...tabs, "statistics"))
    _user: User,
    @Context() context: RequestContext,
  ) {
    const params = context.url.searchParams;
    const inspection = findRoute(params.get("route") ?? undefined);
    assert(inspection, 404, ROUTE_NOT_FOUND);
    const window = resolveWindow(
      {
        from: params.get("from") ?? undefined,
        to: params.get("to") ?? undefined,
        comparison: params.get("comparison") ?? undefined,
      },
      DEFAULT_WINDOW_DAYS,
    );
    return getRouteStatistics(models(), inspection, window);
  }
}
