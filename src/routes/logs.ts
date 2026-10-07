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
import { RequestLogModel, RouteModel } from "@/db";
import { LogsPage } from "@/pages/logs";
import { OverviewPage } from "@/pages/overview";
import { logsLink, routeLink, routeRef } from "@/services/links";
import { getMaxLogDays } from "@/services/period";
import { getRequestLog } from "@/services/request-log/read";
import { listRequestLogs, type SourceQuery } from "@/services/request-log/list";
import { getScopedRouteKeys } from "@/services/scope";
import { bytesToKb } from "@/services/settings-form";
import { getActiveScope } from "@/services/settings";
import { getLiveTraffic } from "@/services/live";
import { findRoute } from "@/services/route-catalog";

function sourceQuery(context: RequestContext): SourceQuery {
  return Object.fromEntries(context.url.searchParams.entries());
}

async function scopeKeys() {
  return getScopedRouteKeys(GetModel(RouteModel), getActiveScope());
}

/**
 * The request tables' route (the request logs page and the Overview's recent
 * requests), the live histogram above the logs, and one request in full for
 * the drawer.
 */
export class LogsController extends Controller("/api/monitoring/logs") {
  @Get("")
  async listLogs(
    @AuthUserWithPermission(LogsPage.requests) _user: User,
    @Context() context: RequestContext,
  ) {
    return listRequestLogs(
      GetModel(RequestLogModel),
      sourceQuery(context),
      await scopeKeys(),
    );
  }

  /**
   * The same rows for the Overview: the recent requests table lives on a page
   * of its own permission, so it reads through a route of its own.
   */
  @Get("recent")
  async listRecent(
    @AuthUserWithPermission(
      OverviewPage.dashboard.targetChild("recent", "requests", "table"),
    )
    _user: User,
    @Context() context: RequestContext,
  ) {
    return listRequestLogs(
      GetModel(RequestLogModel),
      sourceQuery(context),
      await scopeKeys(),
    );
  }

  @Get("live")
  async getLive(@AuthUserWithPermission(LogsPage.live) _user: User) {
    const config = getConfig();
    return {
      ...(await getLiveTraffic(GetModel(RequestLogModel), await scopeKeys())),
      retentionDays: getMaxLogDays(),
      maxBodyKb: bytesToKb(config.requestLogMaxBodySize),
    };
  }

  @Get(":id")
  async getLog(
    @AuthUserWithPermission(LogsPage.requests) _user: User,
    @Parameter("id", "param") id: string,
  ) {
    const log = await getRequestLog(GetModel(RequestLogModel), id);
    assert(log, 404, "Log not found");
    const ref = routeRef(log.method, log.uri);
    const route = findRoute(ref);
    return {
      _id: log._id,
      timestamp: log.timestamp,
      method: log.method,
      uri: log.uri,
      rawPath: log.rawPath,
      statusCode: log.statusCode,
      responseTimeMs: log.responseTimeMs,
      ip: log.ip,
      userAgent: log.userAgent,
      pathParams: log.pathParams,
      query: log.query,
      requestHeaders: log.requestHeaders,
      requestBody: log.requestBody,
      requestBodyTruncated: log.requestBodyTruncated,
      responseHeaders: log.responseHeaders,
      responseBody: log.responseBody,
      responseBodyTruncated: log.responseBodyTruncated,
      error: log.error,
      route: ref,
      routeRegistered: route !== undefined,
      slowThresholdMs: getConfig().requestSlownessThreshold,
      links: {
        route: route ? routeLink(ref) : null,
        tester: route ? routeLink(ref, "2") : null,
        sameError: log.error?.message
          ? logsLink({ route: ref, error: log.error.message })
          : null,
        sameRoute: logsLink({ route: ref }),
      },
    };
  }
}
