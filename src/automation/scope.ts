import { GetModel } from "@antelopejs/interface-database-decorators";
import { RouteModel } from "@/db";
import { getScopedRouteKeys } from "@/services/scope";
import { getActiveScope } from "@/services/settings";

/**
 * `METHOD:uri` keys visible under the active monitoring scope, or null when
 * the scope is "all" (no filtering) — same contract as the read endpoints.
 */
export async function activeScopeKeys(): Promise<Set<string> | null> {
  return getScopedRouteKeys(GetModel(RouteModel), getActiveScope());
}

/** Scoped route count: size of the key set, or every synced route for "all". */
export async function countScopedRoutes(
  keys: Set<string> | null,
): Promise<number> {
  if (keys) return keys.size;
  const all = await GetModel(RouteModel).getAll();
  return all.length;
}
