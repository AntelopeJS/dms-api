import type { RequestLogModel, RouteStatisticsModel } from "@/db";
import type {
  RequestLogFilters,
  RequestLogPage,
} from "@/db/models/request_log.model";
import type { RequestLog } from "@/db/tables/request_log.table";
import { type DayStatistics, MS_PER_DAY } from "@/types";
import { createMemo } from "../../memo";
import { emptyHistogram, histogramQuantile } from "../statistics-utils";

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

/** Days of traffic a route's latency is read over, in the request panel. */
const ROUTE_LATENCY_WINDOW_DAYS = 7;

/** What a request's duration compares to, in the panel: its route's usual. */
export interface RouteLatency {
  windowDays: number;
  /** Median and p95 of the route's measured calls, in ms. */
  p50: number;
  p95: number;
  /** Requests of the window at or above the slowness threshold. */
  slow: number;
}

/** The stores a route's latency is read from. */
export interface RouteLatencySources {
  stats: Pick<RouteStatisticsModel, "getByRoute">;
  logs: Pick<RequestLogModel, "list">;
}

/**
 * A route's latency is read again at most every minute: every request the
 * panel opens on the same route asks for it.
 */
const routeLatencies = createMemo(64, 60_000);

/** The latency histogram and extremes of the days from `firstDay` on. */
function daysLatency(days: readonly DayStatistics[], firstDay: number) {
  const histogram = emptyHistogram();
  let min = Infinity;
  let max = 0;
  for (const day of days) {
    if (day.day < firstDay || day.timedRequestsCount === 0) continue;
    day.latencyHistogram.forEach((count, index) => {
      histogram[index] += count;
    });
    min = Math.min(min, day.minResponseTime);
    max = Math.max(max, day.maxResponseTime);
  }
  return { histogram, range: { min, max } };
}

/**
 * The p50 and p95 of a route over its last days, read from its day rollups'
 * latency histograms (the Tester's calls are not in them), and how many of
 * its requests were slow, counted by the database. Null with no call
 * measured.
 */
export function getRouteLatency(
  sources: RouteLatencySources,
  route: { method: string; uri: string },
  slowThresholdMs: number,
  now: Date = new Date(),
): Promise<RouteLatency | null> {
  const key = `${route.method} ${route.uri} ${slowThresholdMs}`;
  return routeLatencies.cached(key, async () => {
    const since = new Date(
      now.getTime() - ROUTE_LATENCY_WINDOW_DAYS * MS_PER_DAY,
    );
    const firstDay = new Date(since).setHours(0, 0, 0, 0);
    const [rollup, slow] = await Promise.all([
      sources.stats.getByRoute(route.method, route.uri),
      sources.logs.list(
        {
          routeMethod: route.method,
          uri: route.uri,
          since,
          apiTrafficOnly: true,
          slowThresholdMs,
        },
        { limit: 0 },
      ),
    ]);
    const { histogram, range } = daysLatency(
      rollup?.statistics ?? [],
      firstDay,
    );
    const p50 = histogramQuantile(histogram, 0.5, range);
    const p95 = histogramQuantile(histogram, 0.95, range);
    if (p50 === null || p95 === null) return null;
    return {
      windowDays: ROUTE_LATENCY_WINDOW_DAYS,
      p50,
      p95,
      slow: slow.total,
    };
  });
}
