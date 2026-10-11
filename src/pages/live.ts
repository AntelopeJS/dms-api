import type {
  Component,
  ComponentBuilder,
} from "@antelopejs/interface-dms/component";
import { childComponentClientId } from "@antelopejs/interface-dms/page/internal/component-target";
import { apiBlock } from "./blocks";

/** The monitoring pages with a live mode. */
type LivePage = "logs" | "overview" | "routes";

/** What the Live / Pause control of a page toolbar is told. */
export interface LiveControlOptions {
  page: LivePage;
  /**
   * The `/since` route of the page's request table: what the control counts
   * as "n new requests" while the table does not move.
   */
  sinceUrl: string;
  /** The page's period when its URL names none (`?window=`). */
  defaultWindow?: string;
  /** Query key of the selected route, whose requests the count keeps to. */
  routeKey?: string;
  /**
   * The page's health route (the Overview): paused, the control reads its
   * verdict with the count, and says when it changed.
   */
  healthUrl?: string;
  /**
   * The DMS blocks around the request table ({@link blockClientId}), each
   * one watching the live (`followsLive`): they stay live while the table
   * holds (a request open, a search, Load more).
   */
  liveBlocks?: string[];
}

/**
 * Window event and watch function of a DMS block that follows the live
 * mode by itself (`LIVE_BLOCKS_EVENT` / `LIVE_BLOCKS_FUNCTION` in
 * `frontend-vue/app/utils/liveMode.ts`): the page refresh of the DMS reaches
 * every block, the request table included, which may have to hold.
 */
const LIVE_BLOCKS_EVENT = "dms-api:live-blocks";
const LIVE_BLOCKS_FUNCTION = "dms-api:live-blocks";

/**
 * A DMS block (chart, feed) that reads its data again with the live mode,
 * also while the page's request table holds. Name it in the control's
 * `liveBlocks`.
 */
export function followsLive<T>(
  block: ComponentBuilder<T>,
): ComponentBuilder<T> {
  return block.watch(LIVE_BLOCKS_EVENT, LIVE_BLOCKS_FUNCTION);
}

/**
 * The id the DMS renderer gives the block at `path` below the page's static
 * field `root` (`dashboard`, `health`, `errorShare`), by the DMS's own rule:
 * what a watched event names the block by.
 */
export function blockClientId(root: string, ...path: string[]): string {
  return path.reduce(childComponentClientId, root);
}

/**
 * The page's Live / Pause control, the same on every monitoring page, in its
 * toolbar left of the period. Live by default: the page follows the live feed
 * (`services/live-feed.ts`) and refreshes its blocks, no more often than its
 * own pace; paused, nothing moves and the control counts what arrives.
 */
export function liveControl(
  options: LiveControlOptions,
): ComponentBuilder<LiveControlOptions> {
  return apiBlock<LiveControlOptions>("LiveControl", options);
}

/** What the "n new requests" banner of a request table is told. */
export interface LiveBannerOptions {
  /** Rows of the table's first page: more means "Load more" was used. */
  pageSize: number;
  /**
   * The table is the page (the request logs): new rows are taken in only
   * while its first row is in view, else the banner offers them.
   */
  followScroll?: boolean;
}

/**
 * The banner over a request table, right before it: "↑ 12 new requests · 3
 * in 5xx · Show" while the table does not take new rows in (paused, or held
 * by what the user is doing). Draws nothing otherwise.
 */
export function liveBanner(
  options: LiveBannerOptions,
): ComponentBuilder<LiveBannerOptions> {
  return apiBlock<LiveBannerOptions>("LiveBanner", options);
}

/** The parts of a monitoring page's toolbar, the same on every page. */
export interface PageToolbarParts {
  /** The route scope chip (`scopeChip()`). */
  scope: Component;
  /** A pill right of the scope: the Overview's Beta. */
  badge?: Component;
  /** The Live / Pause control (`liveControl()`). */
  live: Component;
  /** The period of the page (`PeriodWindow`, `LogsPeriod`). */
  period: Component;
}

/**
 * The toolbar of the monitoring pages: `[scope] [badge] ··· [live] [period]`.
 * Each side keeps together, and the right one wraps under the scope when the
 * window is too narrow for both. The children keep their ids (`scope`,
 * `beta`, `live`, `period`): permissions and blocks name them so.
 */
export function pageToolbar(parts: PageToolbarParts): ComponentBuilder {
  const toolbar = apiBlock("PageToolbar").child("scope", parts.scope, {
    slot: "scope",
  });
  if (parts.badge) toolbar.child("beta", parts.badge, { slot: "badge" });
  return toolbar
    .child("live", parts.live, { slot: "live" })
    .child("period", parts.period, { slot: "period" });
}
