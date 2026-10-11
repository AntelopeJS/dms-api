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
import { OVERVIEW_DEFAULT_WINDOW, OverviewPage } from "@/pages/overview";
import { getActivity } from "@/services/activity";
import { ATTENTION_LIMIT, getAttention } from "@/services/attention";
import {
  getErrorShareChart,
  getHealth,
  getSlowestRoutes,
  getStatusClasses,
  getTrafficChart,
  type OverviewModels,
} from "@/services/overview";
import { countRoutes } from "@/services/route-catalog";
import { getScopedRouteKeys } from "@/services/scope";
import { getActiveScope } from "@/services/settings";
import {
  resolveWindow,
  type TimeWindow,
  type WindowPreset,
  windowQueryFrom,
} from "@/services/window";

const DEFAULT_WINDOW: WindowPreset = OVERVIEW_DEFAULT_WINDOW;

/** Most "Needs attention" rows one call returns (`?limit=`). */
const MAX_ATTENTION_LIMIT = 100;

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

async function currentHealth() {
  const keys = await scopeKeys();
  return getHealth(models(), keys, countRoutes(keys));
}

function windowOf(context: RequestContext): TimeWindow {
  return resolveWindow(
    windowQueryFrom(context.url.searchParams),
    DEFAULT_WINDOW,
  );
}

function attentionLimit(context: RequestContext): number {
  const raw = Number(context.url.searchParams.get("limit"));
  return Number.isInteger(raw) && raw > 0
    ? Math.min(raw, MAX_ATTENTION_LIMIT)
    : ATTENTION_LIMIT;
}

const grid = OverviewPage.dashboard;

/**
 * The Overview's blocks. The charts and top lists follow the page's window
 * (`?window=`, or the period selector's `preset` / `from` / `to`); the health
 * and "Needs attention" judge the last 24 h, the activity journal the last
 * 7 days.
 */
export class OverviewController extends Controller("/api/monitoring/overview") {
  /**
   * The verdict, since when and why, and its figures: the Overview's health
   * hero reads it.
   */
  @Get("health")
  async getHealth(@AuthUserWithPermission(OverviewPage.health) _user: User) {
    return currentHealth();
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
    @Context() context: RequestContext,
  ) {
    return getAttention(models(), await scopeKeys(), attentionLimit(context));
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
