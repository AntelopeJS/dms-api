import {
  pageToolbar,
  type PageToolbarProps,
} from "@antelopejs/interface-dms/base/page-toolbar";
import type {
  Component,
  ComponentBuilder,
} from "@antelopejs/interface-dms/component";
import type { PageLiveOptions } from "@antelopejs/interface-dms/page";
import {
  DEFAULT_WINDOW,
  PERIOD_SCOPE,
  WINDOW_PRESETS,
} from "@/services/window";

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

/** What a monitoring page puts in its toolbar besides the live mode. */
export interface MonitoringToolbarOptions {
  /**
   * The blocks on the left, keyed by child id: the scope chip (`scope`), the
   * Overview's Beta badge (`beta`). Permissions name them by these ids.
   */
  leading: Record<string, Component>;
  /**
   * Compare each card with the period right before it, the "vs" figure: the
   * pages with cards. The request logs compare nothing.
   */
  compare?: boolean;
  /**
   * Offer every request kept as well, the DMS "All time" (`ALL`,
   * `?api.period=all`, no bounds sent): the request logs.
   */
  allTime?: boolean;
}

/**
 * The toolbar of the monitoring pages, the DMS `pageToolbar()`: `[scope]
 * [beta] ··· updated · Live / Pause · window · vs · 1H 24H 7D 30D` on one
 * line at one size, wrapping on a narrow window. Paused, the toggle says
 * what was missed ("Paused · 40 new requests · 2 in 5xx").
 *
 * The period is the one every block follows (`PERIOD_SCOPE`), kept in the
 * page URL (`?api.period=last-24h`): a link, a reload and a shared URL show
 * the same period. Without one in the URL, the user's last choice on any
 * page of the module comes back (`rememberKey`), else the last 24 hours. The
 * comparison, where the page offers one, is always on and never offered.
 *
 * The children keep their ids (`scope`, `beta`, `live`, `period`).
 */
export function monitoringToolbar(
  options: MonitoringToolbarOptions,
): ComponentBuilder<PageToolbarProps> {
  const comparison = options.compare ? "previous-period" : "none";
  return pageToolbar({
    leading: options.leading,
    live: { missedLabel: "$api.live_mode.new_requests" },
    period: {
      id: PERIOD_SCOPE,
      rememberKey: PERIOD_SCOPE,
      presets: [
        ...WINDOW_PRESETS,
        ...(options.allTime ? ["all" as const] : []),
      ],
      defaultPreset: DEFAULT_WINDOW,
      comparisons: [comparison],
      defaultComparison: comparison,
    },
  });
}
