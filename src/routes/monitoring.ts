import { Controller, Get, Parameter } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { RequestLogModel, RouteModel, RouteStatisticsModel } from "@/db";
import {
  type ParsedPeriod,
  parsePeriod,
  resolvePeriodDays,
} from "@/services/period";
import { queryRequestLogsScoped } from "@/services/request-log/read";
import { getScopedRouteKeys } from "@/services/scope";
import { getActiveScope } from "@/services/settings";
import {
  getRequestHistory,
  getRequestHistoryHourly,
  getRequestHistoryMinutely,
  getRouteAggregates,
  getSummaryKpis,
  type HistoryPoint,
  type RouteAggregate,
} from "@/services/statistics-aggregate";

const DEFAULT_DAYS = 7;
const SLOW_ROUTES_LIMIT = 5;
const ERROR_ROUTES_LIMIT = 5;
const RECENT_REQUESTS_LIMIT = 10;

@AuthOwnerOnly()
export class MonitoringController extends Controller(
  "/api/monitoring/metrics",
) {
  @Get("")
  async getMonitoring(
    @AuthRawUser() _user: User,
    @Parameter("period", "query") period?: string,
    @Parameter("route", "query") route?: string,
  ) {
    const parsed = resolvePeriod(period);
    const aggregateDays = parsed.granularity === "day" ? parsed.count : 1;
    const routesModel = GetModel(RouteModel);
    const statsModel = GetModel(RouteStatisticsModel);
    const logModel = GetModel(RequestLogModel);
    const keys = await getScopedRouteKeys(routesModel, getActiveScope());

    const [routes, history, aggregates, recentPage] = await Promise.all([
      routesModel.getAll(),
      loadHistory(parsed, logModel, statsModel, keys),
      getRouteAggregates(statsModel, aggregateDays, keys),
      queryRequestLogsScoped(logModel, { limit: RECENT_REQUESTS_LIMIT }, keys),
    ]);

    const filtered = route
      ? aggregates.filter((a) => a.uri === route)
      : aggregates;
    const totalRoutes = keys ? keys.size : routes.length;
    const kpis = await getSummaryKpis(statsModel, totalRoutes, keys);

    return {
      period: {
        granularity: parsed.granularity,
        count: parsed.count,
      },
      kpis,
      history,
      slowest: rankSlowest(filtered),
      mostErroring: rankMostErroring(filtered),
      recent: recentPage.results,
    };
  }
}

// The default window is clamped to the configured retention too — a 7-day
// default would otherwise chart empty days against a shorter retention.
function resolvePeriod(period?: string): ParsedPeriod {
  return (
    parsePeriod(period) ?? {
      granularity: "day",
      count: resolvePeriodDays(undefined, DEFAULT_DAYS),
    }
  );
}

function loadHistory(
  parsed: ParsedPeriod,
  logModel: RequestLogModel,
  statsModel: RouteStatisticsModel,
  keys: Set<string> | null,
): Promise<HistoryPoint[]> {
  const byGranularity = {
    minute: () => getRequestHistoryMinutely(logModel, parsed.count, keys),
    hour: () => getRequestHistoryHourly(logModel, parsed.count, keys),
    day: () => getRequestHistory(statsModel, parsed.count, keys),
  };
  return byGranularity[parsed.granularity]();
}

function rankSlowest(aggregates: RouteAggregate[]): RouteAggregate[] {
  return aggregates
    .slice()
    .sort((a, b) => b.averageLatencyMs - a.averageLatencyMs)
    .slice(0, SLOW_ROUTES_LIMIT);
}

function rankMostErroring(aggregates: RouteAggregate[]): RouteAggregate[] {
  return aggregates
    .slice()
    .filter((a) => a.errorsClient + a.errorsServer > 0)
    .sort(
      (a, b) =>
        b.errorsClient + b.errorsServer - (a.errorsClient + a.errorsServer),
    )
    .slice(0, ERROR_ROUTES_LIMIT);
}
