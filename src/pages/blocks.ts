import type { ComponentBuilder } from "@antelopejs/interface-dms/component";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";

/**
 * The console's own blocks: the parts of its pages no DMS block draws. Each
 * one is a Vue component of `frontend-vue/app/components/blocks`, registered
 * under the module's `DmsApi` prefix, and named for the permission tree by an
 * i18n key, like the DMS names its own blocks.
 */
export type ApiBlock =
  | "ScopeChip"
  | "HealthHero"
  | "LiveTraffic"
  | "RequestDetail"
  | "RouteTree"
  | "RouteHeader"
  | "RouteStatistics"
  | "RouteDocumentation"
  | "RouteTester"
  | "SplitLayout";

const BLOCK_ICONS: Record<ApiBlock, string> = {
  ScopeChip: "i-ph-funnel",
  HealthHero: "i-ph-heartbeat",
  LiveTraffic: "i-ph-broadcast",
  RequestDetail: "i-ph-sidebar-simple",
  RouteTree: "i-ph-tree-structure",
  RouteHeader: "i-ph-signpost",
  RouteStatistics: "i-ph-chart-bar",
  RouteDocumentation: "i-ph-book-open-text",
  RouteTester: "i-ph-paper-plane-tilt",
  SplitLayout: "i-ph-columns",
};

/** `HealthHero` → `health_hero`: the i18n key segment of a block. */
function i18nSegment(block: ApiBlock): string {
  return block.replace(/(?<!^)([A-Z])/g, "_$1").toLowerCase();
}

/** One of the console's blocks, named and described for the roles editor. */
export function apiBlock<T = Record<string, unknown>>(
  block: ApiBlock,
  options?: T,
): ComponentBuilder<T> {
  const key = `$api.blocks.${i18nSegment(block)}`;
  const builder = CustomComponent(`DmsApi${block}`) as ComponentBuilder<T>;
  return builder.options(options).meta({
    name: `${key}.name`,
    description: `${key}.description`,
    icon: BLOCK_ICONS[block],
  });
}
