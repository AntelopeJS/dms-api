import { GetModel } from "@antelopejs/interface-database-decorators";
import type { ComponentBuilder } from "@antelopejs/interface-dms/component";
import { RouteModel } from "@/db";
import { settingsLink } from "@/services/links";
import { countScopedRoutes, getScopedRouteKeys } from "@/services/scope";
import { getActiveScope } from "@/services/settings";
import { apiBlock } from "./blocks";

/** What the scope chip shows: the active route scope and how many it holds. */
export interface ScopeChipOptions {
  scope?: string;
  routes?: number;
  to?: string;
}

/**
 * The "Own routes · 42" chip of a page toolbar. The scope is filled in for
 * each request, so the chip always names the scope the page was served with.
 */
export function scopeChip(): ComponentBuilder<ScopeChipOptions> {
  return apiBlock<ScopeChipOptions>("ScopeChip", {}).onFilter(
    async (_permissions, options) => {
      const routes = GetModel(RouteModel);
      const scope = getActiveScope();
      const keys = await getScopedRouteKeys(routes, scope);
      return {
        ...options,
        scope,
        routes: await countScopedRoutes(routes, keys),
        to: settingsLink(),
      };
    },
  );
}
