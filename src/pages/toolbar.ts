import { LiveToggle } from "@antelopejs/interface-dms/base/live-toggle";
import { HStack, Spacer } from "@antelopejs/interface-dms/base/stack";
import type {
  Component,
  ComponentBuilder,
} from "@antelopejs/interface-dms/component";
import type { PageLiveOptions } from "@antelopejs/interface-dms/page";

/**
 * The live mode of a monitoring page (its `live` option): each block read
 * again at most every `maxRate` seconds in Direct, and polled at that pace
 * while the realtime stream is down. `slowMaxRate` replaces it once the
 * page's period spans a week, where only the last bucket moves. The Direct
 * / Pause choice is one for the module's pages (`rememberKey`).
 */
export function liveMode(
  maxRate: number,
  slowMaxRate?: number,
): PageLiveOptions {
  return {
    maxRate,
    ...(slowMaxRate && {
      slowRateAfter: { period: "7d", maxRate: slowMaxRate },
    }),
    rememberKey: "api",
  };
}

/** The parts of a monitoring page's toolbar, the same on every page. */
export interface PageToolbarParts {
  /** The route scope chip (`scopeChip()`). */
  scope: Component;
  /** A pill right of the scope: the Overview's Beta. */
  badge?: Component;
  /** The page's period. */
  period: Component;
}

/**
 * The toolbar of the monitoring pages, a DMS `HStack`: `[scope] [badge] ···
 * [live] [period]` on one line, wrapping on a narrow window. `live` is the
 * DMS `LiveToggle` as a pill: a pulsing "Live" and Pause over the page's
 * realtime (its `live` option), "Updated 12 s ago" and the L key; paused,
 * why and what was missed ("Paused · 40 new requests · 2 in 5xx"), and
 * Resume. The children keep their ids (`scope`, `beta`, `live`, `period`):
 * permissions and blocks name them so.
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
    .child(
      "live",
      LiveToggle({
        align: "right",
        variant: "pill",
        missedLabel: "$api.live_mode.new_requests",
      }),
    )
    .child("period", parts.period);
}
