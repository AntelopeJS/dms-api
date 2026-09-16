import { Controller, Get, Parameter } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { getConfig } from "@/config";
import { RequestLogModel, RouteModel } from "@/db";
import type {
  RequestLogFilters,
  RequestLogStatusClass,
} from "@/db/models/request_log.model";
import {
  getRequestLog,
  queryRequestLogsScoped,
} from "@/services/request-log/read";
import { getScopedRouteKeys } from "@/services/scope";
import { getActiveScope } from "@/services/settings";
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from "@/types";

type LogTab = "requests" | "errors" | "slow";

const TAB_FILTERS: Record<LogTab, Partial<RequestLogFilters>> = {
  requests: {},
  errors: { statusClass: "server-error" },
  slow: {},
};

const STATUS_CLASSES: ReadonlySet<string> = new Set([
  "success",
  "client-error",
  "server-error",
]);

const PERIOD_UNIT_MS: Record<string, number> = {
  s: MS_PER_SECOND,
  m: MS_PER_MINUTE,
  h: MS_PER_HOUR,
  d: MS_PER_DAY,
};

@AuthOwnerOnly()
export class LogsController extends Controller("/api/monitoring/logs") {
  @Get("")
  // Each parameter is bound to a request input by its decorator, so
  // the framework hands them in positionally: an options object is not
  // expressible here.
  // oxlint-disable-next-line eslint/max-params
  async listLogs(
    @AuthRawUser() _user: User,
    @Parameter("tab", "query") tab?: string,
    @Parameter("period", "query") period?: string,
    @Parameter("method", "query") method?: string,
    @Parameter("status", "query") status?: string,
    @Parameter("search", "query") search?: string,
    @Parameter("cursor", "query") cursor?: string,
    @Parameter("limit", "query") limit?: string,
  ) {
    const filters = buildLogFilters(
      { tab, period, method, status, search, cursor, limit },
      getConfig().requestSlownessThreshold,
    );
    const keys = await getScopedRouteKeys(
      GetModel(RouteModel),
      getActiveScope(),
    );
    return queryRequestLogsScoped(GetModel(RequestLogModel), filters, keys);
  }

  @Get(":id")
  async getLog(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ) {
    const log = await getRequestLog(GetModel(RequestLogModel), id);
    assert(log, 404, "Log not found");
    return log;
  }
}

interface LogQueryParams {
  tab?: string;
  period?: string;
  method?: string;
  status?: string;
  search?: string;
  cursor?: string;
  limit?: string;
}

function buildLogFilters(
  params: LogQueryParams,
  slowThresholdMs: number,
): RequestLogFilters {
  const resolvedTab: LogTab =
    (params.tab as LogTab) in TAB_FILTERS ? (params.tab as LogTab) : "requests";

  const filters: RequestLogFilters = {
    ...TAB_FILTERS[resolvedTab],
    method: params.method,
    search: params.search,
    cursor: params.cursor,
    limit: parseLimit(params.limit),
  };

  if (params.status) {
    if (STATUS_CLASSES.has(params.status)) {
      filters.statusClass = params.status as RequestLogStatusClass;
    } else {
      const n = parseInt(params.status, 10);
      if (!Number.isNaN(n)) {
        filters.statusMin = n;
        filters.statusMax = n;
      }
    }
  }

  if (params.period) {
    const ms = periodToMs(params.period);
    if (ms !== undefined) filters.since = new Date(Date.now() - ms);
  }

  if (resolvedTab === "slow") {
    filters.slowThresholdMs = slowThresholdMs;
  }

  return filters;
}

function parseLimit(raw?: string): number | undefined {
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) return undefined;
  return n;
}

function periodToMs(period: string): number | undefined {
  const m = period.match(/^(\d+)([smhd])$/);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  if (n <= 0) return undefined;
  return n * PERIOD_UNIT_MS[m[2]];
}
