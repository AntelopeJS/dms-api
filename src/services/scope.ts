import { GetModuleInfo, ListModules } from "@antelopejs/interface-core/modules";
import type { RouteModel } from "@/db";

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
 * Resolve the set of module ids considered "own": modules whose source is the
 * local project rather than a downloaded package. Routes registered by any
 * other module (or with no resolvable module) belong to the `modules` bucket.
 */
export async function getOwnModuleIds(): Promise<Set<string>> {
  const ids = await ListModules();
  const own = new Set<string>();
  await Promise.all(
    ids.map(async (id: string) => {
      try {
        const info = await GetModuleInfo(id);
        if (info.source.type === "local") own.add(id);
      } catch {
        // Module vanished between list and info — treat as not own.
      }
    }),
  );
  return own;
}

/** Composite key shared with routes_statistics / request_log lookups. */
export function scopeRouteKey(method: string, uri: string): string {
  return `${method.toUpperCase()}:${uri}`;
}

/**
 * Set of `METHOD:uri` keys visible under `scope`, resolved from the synced
 * routes table. Returns null for `all` — callers skip filtering entirely.
 */
export async function getScopedRouteKeys(
  routesModel: RouteModel,
  scope: RouteScope,
): Promise<Set<string> | null> {
  if (scope === "all") return null;
  const wanted = scope === "own";
  const routes = await routesModel.table
    .filter((route) => route.key("own").default(false).eq(true).eq(wanted))
    .map((route) => ({ method: route.key("method"), uri: route.key("uri") }))
    .run();
  return new Set(routes.map((route) => scopeRouteKey(route.method, route.uri)));
}
