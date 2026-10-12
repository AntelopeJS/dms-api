import {
  PeriodSelector,
  type PeriodSelectorProps,
} from "@antelopejs/interface-dms/base/period-selector";
import type { ComponentBuilder } from "@antelopejs/interface-dms/component";
import {
  DEFAULT_WINDOW,
  PERIOD_SCOPE,
  WINDOW_PRESETS,
} from "@/services/window";

export { PERIOD_SCOPE };

/** What a page's period selector offers besides its presets. */
export interface PeriodSelectorOptions {
  /**
   * Compare each card with the period right before it, the "vs" figure: the
   * pages with cards. The request logs compare nothing.
   */
  compare?: boolean;
  /**
   * Offer every request kept as well, the DMS "All time" (`?api.period=all`,
   * no bounds sent): the request logs.
   */
  allTime?: boolean;
}

/**
 * The period of a console page, the DMS `PeriodSelector`, drawn as mwesto's
 * toolbar had it: the start of the window from now ("since yesterday
 * 17:05"), then the 1H / 24H / 7D / 30D pills, the comparison with the
 * period before always on and never offered. Its id is the period scope its
 * blocks follow (`PERIOD_SCOPE`), and the DMS keeps it in the page URL
 * (`?api.period=last-24h`): a link, a reload and a shared URL show the same
 * period. Without one in the URL, the user's last choice on any page of the
 * module comes back (`rememberKey`), else the last 24 hours.
 */
export function periodSelector(
  options: PeriodSelectorOptions = {},
): ComponentBuilder<PeriodSelectorProps> {
  const comparison = options.compare ? "previous-period" : "none";
  return PeriodSelector({
    id: PERIOD_SCOPE,
    rememberKey: PERIOD_SCOPE,
    variant: "segmented",
    size: "sm",
    align: "right",
    rangeLabel: "relative",
    presets: [...WINDOW_PRESETS, ...(options.allTime ? ["all" as const] : [])],
    defaultPreset: DEFAULT_WINDOW,
    comparisons: [comparison],
    defaultComparison: comparison,
    comparisonControl: "hidden",
  });
}
