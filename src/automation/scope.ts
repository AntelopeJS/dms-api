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
