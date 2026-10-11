import type { RequestLogModel } from "@/db";
import type {
  RequestLogFilters,
  RequestLogPage,
} from "@/db/models/request_log.model";
import type { RequestLog } from "@/db/tables/request_log.table";
import { MS_PER_DAY } from "@/types";
import { createMemo } from "../../memo";
import { exactQuantile } from "../statistics-utils";

/**
 * How far back a scoped query reaches when its caller names no window. Wide
 * enough for the panels that ask for "the most recent N" (recent requests,
 * recent errors, last incident) and narrow enough that a scope matching little
 * or nothing cannot turn one of those into a full-table read.
 */
const UNBOUNDED_SCAN_FLOOR_MS = 30 * MS_PER_DAY;

/**
 * Read request logs, restricted to a route scope: only logs whose
 * `METHOD:uri` key is in `keys` are returned (null → no filtering).
 *
 * This is the only read path. An unscoped helper used to sit beside it, and
 * having both invited callers to reach for the one that silently ignores the
 * scope; pass `null` to say so explicitly.
 *
 * The scope goes to the database as a query predicate rather than a filter
 * applied to fetched pages. Filtering after the fetch used to cap the raw
 * scan at a fixed number of pages, so a scope holding a small share of the
 * traffic came back short — or empty with a non-null cursor, which the Logs
 * page renders as "no logs" with no way to page further.
 */
export function queryRequestLogsScoped(
  model: RequestLogModel,
  filters: RequestLogFilters,
  keys: Set<string> | null | undefined,
): Promise<RequestLogPage> {
  if (!keys) return model.query(filters);
  // A scope with no routes matches nothing by definition. Answering it without
  // a query matters: the predicate is an `$expr`, so the database cannot use an
  // index to prove the emptiness — it would read the whole table to find the
  // zero rows it was always going to return.
  if (keys.size === 0)
    return Promise.resolve({ results: [], nextCursor: null });
  return model.query({
    // Same reason the empty case short-circuits: the scope predicate is not
    // indexable, so a query that cannot fill its page reads until the log runs
    // out. A caller naming no window would scan the whole retention to answer
    // "the last 10", which on a sparse scope means every row. The floor keeps
    // that proportional to recent traffic; callers wanting more say so.
    since: new Date(Date.now() - UNBOUNDED_SCAN_FLOOR_MS),
    ...filters,
    routeKeys: [...keys],
  });
}

export async function getRequestLog(
  model: RequestLogModel,
  id: string,
): Promise<RequestLog | undefined> {
  return model.get(id);
}

/**
 * Fetch the most recent N logs for a route, identified by method and URI
 * pattern. Used by the per-route Statistics tab as the input to the history
 * table. Not by `routeId`: that is interface-api's in-process counter, so a
 * stored value names a different route (or none) after a restart.
 */
export async function getRecentLogsForRoute(
  model: Pick<RequestLogModel, "query">,
  method: string,
  uri: string,
  limit = 20,
): Promise<RequestLog[]> {
  const page = await model.query({ method, uri, limit });
  return page.results;
}

/** Days of traffic a route's latency is read over, in the request panel. */
export const ROUTE_LATENCY_WINDOW_DAYS = 7;

/** What a request's duration compares to, in the panel: its route's usual. */
export interface RouteLatency {
  windowDays: number;
  /** Medians of the measured successful requests (< 400), in ms. */
  p50: number;
  p95: number;
  /** Requests of the window at or above the slowness threshold. */
  slow: number;
}

/**
 * A route's latency is read again at most every minute: every request the
 * panel opens on the same route asks for it, over a week of traffic.
 */
const routeLatencies = createMemo(64, 60_000);

/**
 * The p50 and p95 of a route over the last days, the Tester's requests left
 * out, as the Documentation reads them; null with no successful request
 * measured.
 */
export function getRouteLatency(
  model: Pick<RequestLogModel, "samples">,
  route: { method: string; uri: string },
  slowThresholdMs: number,
  now: Date = new Date(),
): Promise<RouteLatency | null> {
  const key = `${route.method} ${route.uri} ${slowThresholdMs}`;
  return routeLatencies.cached(key, async () => {
    const samples = await model.samples({
      routeMethod: route.method,
      uri: route.uri,
      since: new Date(now.getTime() - ROUTE_LATENCY_WINDOW_DAYS * MS_PER_DAY),
      apiTrafficOnly: true,
    });
    const measured = samples.filter(
      (sample): sample is typeof sample & { responseTimeMs: number } =>
        typeof sample.responseTimeMs === "number",
    );
    const successful = measured
      .filter((sample) => sample.statusCode < 400)
      .map((sample) => sample.responseTimeMs);
    const p50 = exactQuantile(successful, 0.5);
    const p95 = exactQuantile(successful, 0.95);
    if (p50 === null || p95 === null) return null;
    return {
      windowDays: ROUTE_LATENCY_WINDOW_DAYS,
      p50,
      p95,
      slow: measured.filter(
        (sample) => sample.responseTimeMs >= slowThresholdMs,
      ).length,
    };
  });
}
