import {
  Context,
  Controller,
  Get,
  type RequestContext,
} from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { AuthUserWithPermission } from "@antelopejs/interface-dms/guards";
import { RequestLogModel, RouteModel, RouteStatisticsModel } from "@/db";
import { OverviewPage } from "@/pages/overview";
import { getActivity } from "@/services/activity";
import { healthBanner, healthStats } from "@/services/health-blocks";
import {
  getAttention,
  getErrorShareChart,
  getHealth,
  getSlowestRoutes,
  getStatusClasses,
  getTrafficChart,
  type OverviewModels,
} from "@/services/overview";
import { countScopedRoutes, getScopedRouteKeys } from "@/services/scope";
import { getActiveScope } from "@/services/settings";
import { resolveWindow, type TimeWindow } from "@/services/window";

const DEFAULT_WINDOW_DAYS = 7;

function models(): OverviewModels {
  return {
    logs: GetModel(RequestLogModel),
    stats: GetModel(RouteStatisticsModel),
    routes: GetModel(RouteModel),
  };
}

function scopeKeys() {
  return getScopedRouteKeys(GetModel(RouteModel), getActiveScope());
}

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

/** The health of the scoped routes over the last 24 hours. */
async function health() {
  const keys = await scopeKeys();
  return getHealth(
    models(),
    keys,
    await countScopedRoutes(GetModel(RouteModel), keys),
  );
}

const grid = OverviewPage.dashboard;

/**
 * The Overview's blocks. The charts and top lists follow the page's period
 * selector (`from` / `to` / `comparison`); the health hero, "Needs
 * attention" and the activity feed are about now.
 */
export class OverviewController extends Controller("/api/monitoring/overview") {
  @Get("health")
  async getHealthBanner(
    @AuthUserWithPermission(OverviewPage.health) _user: User,
  ) {
    return healthBanner(await health());
  }

  @Get("health/figures")
  async getHealthFigures(
    @AuthUserWithPermission(OverviewPage.figures) _user: User,
  ) {
    return healthStats(await health());
  }

  @Get("traffic")
  async getTraffic(
    @AuthUserWithPermission(grid.targetChild("traffic", "chart")) _user: User,
    @Context() context: RequestContext,
  ) {
    return getTrafficChart(models(), windowOf(context), await scopeKeys());
  }

  @Get("classes")
  async getClasses(
    @AuthUserWithPermission(grid.targetChild("traffic", "classes")) _user: User,
    @Context() context: RequestContext,
  ) {
    return getStatusClasses(models(), windowOf(context), await scopeKeys());
  }

  @Get("error-share")
  async getErrorShare(
    @AuthUserWithPermission(grid.targetChild("health", "errorShare"))
    _user: User,
    @Context() context: RequestContext,
  ) {
    return getErrorShareChart(models(), windowOf(context), await scopeKeys());
  }

  @Get("attention")
  async getAttention(
    @AuthUserWithPermission(grid.targetChild("health", "attention"))
    _user: User,
  ) {
    return getAttention(models(), await scopeKeys());
  }

  @Get("slowest")
  async getSlowest(
    @AuthUserWithPermission(grid.targetChild("health", "slowest")) _user: User,
    @Context() context: RequestContext,
  ) {
    return getSlowestRoutes(models(), windowOf(context), await scopeKeys());
  }

  @Get("activity")
  async getActivity(
    @AuthUserWithPermission(grid.targetChild("recent", "activity"))
    _user: User,
  ) {
    return getActivity(models(), await scopeKeys());
  }
}
