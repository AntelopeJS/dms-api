import { GetModel } from "@antelopejs/interface-database-decorators";
import type { ComponentBuilder } from "@antelopejs/interface-dms/component";
import { RouteModel } from "@/db";
import { settingsLink } from "@/services/links";
import { countRoutes } from "@/services/route-catalog";
import { getScopedRouteKeys } from "@/services/scope";
import { getActiveScope } from "@/services/settings";
import { apiBlock } from "./blocks";

/** What the scope chip shows: the active route scope and how many it holds. */
export interface ScopeChipOptions {
  scope?: string;
  routes?: number;
  to?: string;
  /** Read again as the chip mounts: `{ scope, routes }`, the scope in force. */
  fetchUrl?: string;
}

/** The settings every page reads, the scope among them. */
const SETTINGS_SUMMARY_URL = "/api/monitoring/settings/summary";

/**
 * The "Own routes · 42" chip of a page toolbar. The scope is filled in for
 * each request, and read again as the chip mounts: a page shown again from
 * the history (back from Settings, a panel closed) keeps the layout it was
 * served with, so the chip would name the scope of before.
 */
export function scopeChip(): ComponentBuilder<ScopeChipOptions> {
  return apiBlock<ScopeChipOptions>("ScopeChip", {
    fetchUrl: SETTINGS_SUMMARY_URL,
  }).onFilter(async (_permissions, options) => {
    const scope = getActiveScope();
    const keys = await getScopedRouteKeys(GetModel(RouteModel), scope);
    return {
      ...options,
      scope,
      routes: countRoutes(keys),
      to: settingsLink(),
    };
  });
}
