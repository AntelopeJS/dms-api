import { Controller, Get, Parameter } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { RequestLogModel, RouteModel, RouteStatisticsModel } from "@/db";
import {
  getFolderInspection,
  getRouteInspection,
} from "@/services/introspection";
import { parsePeriodDays, resolvePeriodDays } from "@/services/period";
import { getRecentLogsForRoute } from "@/services/request-log/read";
import { getScopedRouteKeys } from "@/services/scope";
import { getActiveScope } from "@/services/settings";
import {
  getFolderAggregate,
  getRouteAggregate,
} from "@/services/statistics-aggregate";
import {
  getResponseTimesStatistics,
  getRouteStatistics,
} from "@/services/statistics-read";
import { buildRoutesTreeNodes } from "@/services/tree";

const DEFAULT_STATS_DAYS = 7;
const RECENT_LOGS_DEFAULT = 20;

/**
 * Controller for the Routes page: the route tree on the left, plus
 * per-route and per-folder payloads driving the Documentation,
 * Configuration and Statistics tabs on the right.
 */
@AuthOwnerOnly()
export class RoutesController extends Controller("/api/monitoring/routes") {
  @Get("tree")
  async getTree(
    @AuthRawUser() _user: User,
    @Parameter("period", "query") period?: string,
  ) {
    const [stats, keys] = await Promise.all([
      GetModel(RouteStatisticsModel).getAll(),
      getScopedRouteKeys(GetModel(RouteModel), getActiveScope()),
    ]);
    return buildRoutesTreeNodes(stats, keys, parsePeriodDays(period));
  }

  @Get("route/:id/doc")
  async getRouteDoc(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ) {
    const inspection = getRouteInspection(id);
    assert(inspection, 404, "Route not found");
    const route = await GetModel(RouteModel).get(id);
    return {
      ...inspection,
      registeredAt: route?.createdAt ?? null,
      updatedAt: route?.updatedAt ?? null,
    };
  }

  @Get("route/:id/config")
  async getRouteConfig(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ) {
    const inspection = getRouteInspection(id);
    assert(inspection, 404, "Route not found");
    return inspection;
  }

  @Get("route/:id/stats")
  async getRouteStats(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
    @Parameter("period", "query") period?: string,
  ) {
    const inspection = getRouteInspection(id);
    assert(inspection, 404, "Route not found");
    const days = resolvePeriodDays(period, DEFAULT_STATS_DAYS);
    const stats = GetModel(RouteStatisticsModel);
    const log = GetModel(RequestLogModel);

    const [counts, latency, aggregate, recent] = await Promise.all([
      getRouteStatistics(stats, inspection.method, inspection.location, days),
      getResponseTimesStatistics(
        stats,
        inspection.method,
        inspection.location,
        days,
      ),
      getRouteAggregate(stats, inspection.method, inspection.location, days),
      getRecentLogsForRoute(log, id, RECENT_LOGS_DEFAULT),
    ]);

    return {
      route: {
        id,
        location: inspection.location,
        method: inspection.method,
      },
      aggregate,
      charts: { counts, latency },
      recent,
    };
  }

  @Get("folder/:encodedPath/doc")
  async getFolderDoc(
    @AuthRawUser() _user: User,
    @Parameter("encodedPath", "param") encodedPath: string,
  ) {
    return getFolderInspection(decodePath(encodedPath));
  }

  @Get("folder/:encodedPath/config")
  async getFolderConfig(
    @AuthRawUser() _user: User,
    @Parameter("encodedPath", "param") encodedPath: string,
  ) {
    return getFolderInspection(decodePath(encodedPath));
  }

  @Get("folder/:encodedPath/stats")
  async getFolderStats(
    @AuthRawUser() _user: User,
    @Parameter("encodedPath", "param") encodedPath: string,
    @Parameter("period", "query") period?: string,
  ) {
    const days = resolvePeriodDays(period, DEFAULT_STATS_DAYS);
    return getFolderAggregate(
      GetModel(RouteStatisticsModel),
      decodePath(encodedPath),
      days,
    );
  }
}

function decodePath(encoded: string): string {
  return `/${decodeURIComponent(encoded).split("/").filter(Boolean).join("/")}`;
}
