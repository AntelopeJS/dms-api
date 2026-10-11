import { HStack, Spacer } from "@antelopejs/interface-dms/base/stack";
import type {
  Component,
  ComponentBuilder,
} from "@antelopejs/interface-dms/component";
import { apiBlock } from "./blocks";

/** The monitoring pages with a live mode. */
type LivePage = "logs" | "overview" | "routes";

/** What the Live / Pause control of a page toolbar is told. */
export interface LiveControlOptions {
  page: LivePage;
  /**
   * The `/since` route of the page's request table: what the control counts
   * as "n new requests" while the page is paused.
   */
  sinceUrl: string;
  /** The page's period when its URL names none (`?window=`). */
  defaultWindow?: string;
  /** Query key of the selected route, whose requests the count keeps to. */
  routeKey?: string;
  /**
   * The API's verdict (`{ verdict }`, the Overview): paused, the control
   * reads it with the count, and says when it changed.
   */
  verdictUrl?: string;
}

/**
 * The page's Live / Pause control, the same on every monitoring page, in its
 * toolbar left of the period. Live by default: on each message of the live
 * feed (`services/live-feed.ts`), no more often than the page's pace, it asks
 * every block of the page to read its data again (the DMS page refresh);
 * paused, nothing moves and the control counts what arrives. The blocks carry
 * no `realtimeTopic` of their own: the pause would not hold them.
 */
export function liveControl(
  options: LiveControlOptions,
): ComponentBuilder<LiveControlOptions> {
  return apiBlock<LiveControlOptions>("LiveControl", options);
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
 * The toolbar of the monitoring pages, a DMS `HStack`: `[scope] [badge] ···
 * [live] [period]` on one line, wrapping on a narrow window. The children
 * keep their ids (`scope`, `beta`, `live`, `period`): permissions and blocks
 * name them so.
 */
export function pageToolbar(parts: PageToolbarParts): ComponentBuilder {
  const toolbar = HStack({
    alignment: "center",
    spacing: "0.75rem",
    wrap: true,
  }).child("scope", parts.scope);
  if (parts.badge) toolbar.child("beta", parts.badge);
  return toolbar
    .child("spacer", Spacer())
    .child("live", parts.live)
    .child("period", parts.period);
}
