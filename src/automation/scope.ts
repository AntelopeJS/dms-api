import { GetModel } from "@antelopejs/interface-database-decorators";
import { ApiSettingsModel, RouteModel } from "@/db";
import { getScopedRouteKeys, type RouteScope } from "@/services/scope";
import { getActiveScope, loadSettings } from "@/services/settings";

/**
 * Reads the saved settings again. A node can run on an instance other than
 * the one the Settings page saved on, which keeps the scope and the
 * overrides it loaded at start: every poll and every action reads them
 * first.
 */
export async function refreshSettings(): Promise<void> {
  await loadSettings(GetModel(ApiSettingsModel));
}

/**
 * `METHOD:uri` keys visible under `scope`, the saved one by default, or null
 * when it is "all" (no filtering) — same contract as the read endpoints. The
 * settings are read again first.
 */
export async function activeScopeKeys(
  scope?: RouteScope,
): Promise<Set<string> | null> {
  await refreshSettings();
  return getScopedRouteKeys(GetModel(RouteModel), scope ?? getActiveScope());
}
