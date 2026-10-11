import type { RequestLog } from "@/db/tables/request_log.table";
import { scopeRouteKey } from "../scope";

/**
 * The tables a request panel opens from, each behind its own permission:
 * the request logs page, the Overview's recent requests, the Routes page's
 * recent requests and the Tester.
 */
export type LogTable = "logs" | "overview" | "routes" | "tester";

type ReadLog = Pick<RequestLog, "method" | "routeMethod" | "uri" | "source">;

function inScope(log: ReadLog, keys: Set<string> | null): boolean {
  return (
    keys === null ||
    keys.has(scopeRouteKey(log.routeMethod ?? log.method, log.uri))
  );
}

/**
 * Whether a panel opened from `table` may read `log` in full, headers and
 * bodies: only a request that table can list. `registered` says whether a
 * route of the API answers it, `keys` is the active scope (null: all).
 *  - the request logs page lists every request;
 *  - the Overview lists the requests of the scope;
 *  - the Routes page lists the requests of a route of the scope;
 *  - the Tester reads back its own calls, to any route, and replays a
 *    request the Routes page lists.
 */
export function canReadLog(
  table: LogTable,
  log: ReadLog,
  registered: boolean,
  keys: Set<string> | null,
): boolean {
  switch (table) {
    case "logs":
      return true;
    case "overview":
      return inScope(log, keys);
    case "routes":
      return registered && inScope(log, keys);
    case "tester":
      return log.source === "tester" || (registered && inScope(log, keys));
  }
}
