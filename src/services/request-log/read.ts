import type { RequestLogModel } from "@/db";
import type {
  RequestLogFilters,
  RequestLogPage,
} from "@/db/models/request_log.model";
import type { RequestLog } from "@/db/tables/request_log.table";
import { MS_PER_DAY } from "@/types";

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
 * Fetch the most recent N logs for a given route id. Used by the per-route
 * Statistics tab as the input to the history table.
 */
export async function getRecentLogsForRoute(
  model: RequestLogModel,
  routeId: string,
  limit = 20,
): Promise<RequestLog[]> {
  const page = await model.query({ routeId, limit });
  return page.results;
}
