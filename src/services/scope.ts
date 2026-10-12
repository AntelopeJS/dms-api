import type { RouteModel } from "@/db";
import { getRouteStatsKey } from "@/db/tables/routes_statistics.table";
import { ensureRoutesSynced } from "./routes-sync";

/**
 * Route visibility scope for the monitoring pages.
 *  - `own`: only routes registered by modules loaded from the local project
 *    (the user's own code, `source.type === "local"`).
 *  - `modules`: every route except the own ones (installed Antelope modules).
 *  - `all`: no filtering.
 */
export type RouteScope = "own" | "modules" | "all";

export const ROUTE_SCOPES: RouteScope[] = ["own", "modules", "all"];

export function isRouteScope(value: unknown): value is RouteScope {
  return ROUTE_SCOPES.includes(value as RouteScope);
}

/**
 * Composite key shared with routes_statistics / request_log lookups. The path
 * is canonical (no trailing slash), so a key built from a handler location
 * matches the stored one.
 */
export function scopeRouteKey(method: string, uri: string): string {
  return getRouteStatsKey(method, uri);
}

/**
 * Set of `METHOD:uri` keys visible under `scope`, resolved from the synced
 * routes table. Returns null for `all` — callers skip filtering entirely.
 *
 * Resolved on every call, never cached: the routes table is first synced
 * again when the registered routes changed (a module reloaded), so the scope
 * follows the routes and the setting the moment they change.
 */
export async function getScopedRouteKeys(
  routesModel: RouteModel,
  scope: RouteScope,
): Promise<Set<string> | null> {
  await ensureRoutesSynced(routesModel);
  if (scope === "all") return null;
  const wanted = scope === "own";
  const routes = await routesModel.table
    .filter((route) => route.key("own").default(false).eq(true).eq(wanted))
    .map((route) => ({ method: route.key("method"), uri: route.key("uri") }))
    .run();
  return new Set(routes.map((route) => scopeRouteKey(route.method, route.uri)));
}
