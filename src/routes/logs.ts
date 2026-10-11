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
import { normalizeRoutePath } from "@/db/tables/routes_statistics.table";
import { LOGS_DEFAULT_WINDOW, LogsPage } from "@/pages/logs";
import { OVERVIEW_DEFAULT_WINDOW, OverviewPage } from "@/pages/overview";
import { ROUTES_DEFAULT_WINDOW, RoutesPage } from "@/pages/routes";
import { apiOriginOf } from "@/services/api-origin";
import { logsLink, routeLink, routeRef } from "@/services/links";
import { getMaxLogDays } from "@/services/period";
import { getRequestLog, getRouteLatency } from "@/services/request-log/read";
import {
  listRequestLogs,
  listRequestLogsSince,
  parseAfter,
  type RequestLogListOptions,
  type SourceQuery,
} from "@/services/request-log/list";
import { getScopedRouteKeys } from "@/services/scope";
import { getActiveScope } from "@/services/settings";
import { testerBlock } from "./tester";
import { getLiveTraffic } from "@/services/live";
import { findRoute } from "@/services/route-catalog";

function sourceQuery(context: RequestContext): SourceQuery {
  return Object.fromEntries(context.url.searchParams.entries());
}

/**
 * The query of a table over a page's period: the page's default when the URL
 * names none, as its period selector shows it.
 */
function periodQuery(context: RequestContext, window: string): SourceQuery {
  const query = sourceQuery(context);
  query.filter_window ??= `is:${window}`;
  return query;
}

async function scopeKeys() {
  return getScopedRouteKeys(GetModel(RouteModel), getActiveScope());
}

async function listOf(
  context: RequestContext,
  query = sourceQuery(context),
  options: RequestLogListOptions = {},
) {
  return listRequestLogs(
    GetModel(RequestLogModel),
    query,
    await scopeKeys(),
    options,
  );
}

/** What arrived after `?after=`, under the list's filters (`/since`). */
async function sinceOf(
  query: SourceQuery,
  options: RequestLogListOptions = {},
) {
  const after = parseAfter(query.after);
  assert(after, 400, "after must be an ISO timestamp");
  return listRequestLogsSince(
    GetModel(RequestLogModel),
    query,
    after,
    await scopeKeys(),
    options,
  );
}

/**
 * The Routes page's tables list the requests of the route it selects
 * (`?route=`, a filter of the table), and nothing without one rather than
 * every request of the API.
 */
const ROUTE_TABLE: RequestLogListOptions = { requireRoute: true };

/** The request tables outside the request logs page, by their permission. */
const overviewTable = OverviewPage.dashboard.targetChild(
  "recent",
  "requests",
  "table",
);
const routesTable = RoutesPage.explorer.targetChild(
  "tabs",
  "statistics",
  "recent",
  "requests",
  "table",
);
const tester = testerBlock;

/** One request in full, as the side panel shows it. */
async function logDetail(id: string, context: RequestContext) {
  const model = GetModel(RequestLogModel);
  const log = await getRequestLog(model, id);
  assert(log, 404, "Log not found");
  const method = log.routeMethod ?? log.method;
  const ref = routeRef(method, log.uri);
  const route = findRoute(ref);
  const slowThresholdMs = getConfig().requestSlownessThreshold;
  return {
    _id: log._id,
    timestamp: log.timestamp,
    method: log.method,
    routeMethod: log.routeMethod ?? null,
    uri: log.uri,
    rawPath: log.rawPath,
    statusCode: log.statusCode,
    responseTimeMs: log.responseTimeMs ?? null,
    source: log.source ?? null,
    requestId: log.requestId ?? null,
    ip: log.ip,
    userAgent: log.userAgent,
    pathParams: log.pathParams,
    query: log.query,
    requestHeaders: log.requestHeaders,
    requestBody: log.requestBody,
    requestBodyTruncated: log.requestBodyTruncated,
    // Null on a log captured before the capture said why.
    requestBodyOmitted: log.requestBodyOmitted ?? null,
    // The whole body's bytes when only its start is stored.
    requestBodySize: log.requestBodySize ?? null,
    responseHeaders: log.responseHeaders,
    responseBody: log.responseBody,
    responseBodyTruncated: log.responseBodyTruncated,
    responseBodyOmitted: log.responseBodyOmitted ?? null,
    responseBodySize: log.responseBodySize ?? null,
    redactions: log.redactions ?? null,
    error: log.error,
    route: ref,
    routeRegistered: route !== undefined,
    slowThresholdMs,
    // What the duration compares to: the route's usual, over its last days.
    routeLatency: route
      ? await getRouteLatency(model, { method, uri: log.uri }, slowThresholdMs)
      : null,
    // Where the cURL of the panel sends the request: the real API.
    apiOrigin: apiOriginOf(context),
    links: {
      route: route ? routeLink(ref) : null,
      tester: route ? routeLink(ref, "2") : null,
      sameError: log.error?.message
        ? logsLink({ route: ref, error: log.error.message })
        : null,
      // A path no route answers has no route to list the requests of.
      sameRoute: route ? logsLink({ route: ref }) : null,
      // One resource of a route with parameters (`/api/orders/42`); the
      // route itself otherwise, which `sameRoute` already lists.
      samePath:
        normalizeRoutePath(log.rawPath) !== log.uri
          ? logsLink({ path: log.rawPath })
          : null,
    },
  };
}

/**
 * The request tables' route (the request logs page and the Overview's recent
 * requests), what arrived since a live table's last rows, the live histogram
 * above the logs, and one request in full for the drawer.
 *
 * The list answers `{ results, total, counts }`: `counts` holds the rows of
 * every status tab under all the other filters. `?requestId=<id>` finds the
 * request sent with that `x-request-id` (the Tester's "Captured" tab).
 */
export class LogsController extends Controller("/api/monitoring/logs") {
  /**
   * The request logs page's rows, over its period: its default when the URL
   * names none, as the period selector shows it (`LogsPeriod`).
   */
  @Get("")
  async listLogs(
    @AuthUserWithPermission(LogsPage.requests) _user: User,
    @Context() context: RequestContext,
  ) {
    return listOf(context, periodQuery(context, LOGS_DEFAULT_WINDOW));
  }

  /**
   * What the Overview's recent requests miss while they do not move (live
   * mode paused, or held), by the table's permission: see `/since`.
   */
  @Get("recent/since")
  async listRecentSince(
    @AuthUserWithPermission(overviewTable) _user: User,
    @Context() context: RequestContext,
  ) {
    return sinceOf(periodQuery(context, OVERVIEW_DEFAULT_WINDOW));
  }

  /**
   * The same for the recent requests of the Routes page, by its permission:
   * nothing without a route.
   */
  @Get("routes/since")
  async listRoutesSince(
    @AuthUserWithPermission(routesTable) _user: User,
    @Context() context: RequestContext,
  ) {
    return sinceOf(periodQuery(context, ROUTES_DEFAULT_WINDOW), ROUTE_TABLE);
  }

  /**
   * The same rows for the Overview: the recent requests table lives on a page
   * of its own permission, so it reads through a route of its own, over the
   * page's period: its default when the URL names none.
   */
  @Get("recent")
  async listRecent(
    @AuthUserWithPermission(overviewTable) _user: User,
    @Context() context: RequestContext,
  ) {
    return listOf(context, periodQuery(context, OVERVIEW_DEFAULT_WINDOW));
  }

  /**
   * The last requests of the route the Routes page selects, by the table's
   * permission, over the page's period (its default when the URL names
   * none). Without a route there is nothing to list, rather than every
   * request of the API.
   */
  @Get("routes")
  async listForRoutes(
    @AuthUserWithPermission(routesTable) _user: User,
    @Context() context: RequestContext,
  ) {
    return listOf(
      context,
      periodQuery(context, ROUTES_DEFAULT_WINDOW),
      ROUTE_TABLE,
    );
  }

  /**
   * The Tester's reads: the request it sent, by its `x-request-id`
   * (`?requestId=`, the "Captured" tab), by the Tester's permission.
   */
  @Get("tester")
  async listForTester(
    @AuthUserWithPermission(tester) _user: User,
    @Context() context: RequestContext,
  ) {
    return listOf(context);
  }

  /**
   * `GET /logs/since?after=<ISO timestamp>&<the list's filters>`: the rows
   * newer than `after`, newest first (`limit`, 100 by default, 500 at most,
   * 0 to count only), `count` of the API's (`serverErrors` of them in 5xx),
   * `tester` of the Tester's, and the `cursor` to send as the next `after`.
   * What the live mode's "n new requests" counts.
   */
  @Get("since")
  async listSince(
    @AuthUserWithPermission(LogsPage.requests) _user: User,
    @Context() context: RequestContext,
  ) {
    return sinceOf(periodQuery(context, LOGS_DEFAULT_WINDOW));
  }

  @Get("live")
  async getLive(@AuthUserWithPermission(LogsPage.live) _user: User) {
    return {
      ...(await getLiveTraffic(GetModel(RequestLogModel), await scopeKeys())),
      retentionDays: getMaxLogDays(),
    };
  }

  /**
   * One request for the panel the Overview's recent requests open: the
   * permission of the table it is opened from, not the request logs page's.
   */
  @Get("recent/:id")
  async getRecentLog(
    @AuthUserWithPermission(overviewTable) _user: User,
    @Parameter("id", "param") id: string,
    @Context() context: RequestContext,
  ) {
    return logDetail(id, context);
  }

  /** One request for the Tester: the one it captured, or a replay. */
  @Get("tester/:id")
  async getTesterLog(
    @AuthUserWithPermission(tester) _user: User,
    @Parameter("id", "param") id: string,
    @Context() context: RequestContext,
  ) {
    return logDetail(id, context);
  }

  /** One request for the panel the Routes page's recent requests open. */
  @Get("routes/:id")
  async getRoutesLog(
    @AuthUserWithPermission(routesTable) _user: User,
    @Parameter("id", "param") id: string,
    @Context() context: RequestContext,
  ) {
    return logDetail(id, context);
  }

  @Get(":id")
  async getLog(
    @AuthUserWithPermission(LogsPage.requests) _user: User,
    @Parameter("id", "param") id: string,
    @Context() context: RequestContext,
  ) {
    return logDetail(id, context);
  }
}
