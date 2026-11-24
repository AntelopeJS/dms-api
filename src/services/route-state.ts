import { GetModel } from "@antelopejs/interface-database-decorators";
import { RequestLogModel, RouteStatisticsModel } from "@/db";
import { HEALTH_THRESHOLDS } from "./health-rules";
import { loadRouteHealth } from "./overview";
import { scopeRouteKey } from "./scope";
import { loadRollups } from "./traffic";

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
 * 24 h, with the first day it was called: what the tree, the header and the
 * route automation nodes show next to a route.
 */
export async function routeStates() {
  const [{ lookback, routes }, first] = await Promise.all([
    loadRouteHealth({ logs: GetModel(RequestLogModel) }),
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
