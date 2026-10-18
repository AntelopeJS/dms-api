import type {
  ComposedText,
  ComposedTextParam,
} from "@antelopejs/interface-dms/base/types/composed-text";
import { percent, text } from "./composed-text";
import type { TimeWindow, WindowComparison } from "./window";

/**
 * What every period block of a comparing page shows of the comparison the
 * toolbar picked: a dashed series on its chart, named after the comparison,
 * and a "+12 % vs. 1,020 previous period" line under its figure. Without a
 * comparison ("none") or without the period compared with still stored,
 * neither: the blocks show the period alone.
 */

/** The comparisons a window can carry, as their locale keys name them. */
type Compared = Exclude<WindowComparison, "none">;

const COMPARISON_KEYS: Record<Compared, string> = {
  "previous-period": "previous_period",
  "previous-year": "previous_year",
  custom: "custom",
};

/** The comparison a window shows; null without one or without its data. */
export function shownComparison(window: TimeWindow): Compared | null {
  if (window.comparison === "none" || !window.previous) return null;
  return window.comparison;
}

/**
 * The name of a comparison series ("Previous period", "Same period last
 * year"): what its legend and its tooltip say.
 */
export function comparisonSeriesName(comparison: Compared): string {
  return `$api.compare.series.${COMPARISON_KEYS[comparison]}`;
}

/** What is said in place of the "vs" line when the period is not stored. */
export function noBaselineText(comparison: Compared): string {
  return `$api.compare.no_baseline.${COMPARISON_KEYS[comparison]}`;
}

/**
 * The comparison's buckets laid on the window's, position by position: both
 * span the same length on the same granularity, so the first bucket of one
 * is the first of the other (a calendar shift would split a day across a
 * daylight-saving change). Each point keeps the window's own `x`, so the
 * comparison is drawn over the period it is compared with.
 */
export function alignComparison<T>(
  current: Array<{ start: number }>,
  previous: T[],
  pick: (bucket: T) => number | null,
): Array<{ x: number; y: number | null }> {
  return current.map((bucket, position) => {
    const compared = previous[position];
    return {
      x: bucket.start,
      y: compared === undefined ? null : pick(compared),
    };
  });
}

/** How a change is written: relative ("+12 %") or in points ("+1.2 pt"). */
export type ChangeUnit = "percent" | "pt";

const PERCENT = 100;
const ONE_DECIMAL = 10;

function signOf(change: number): string {
  return change < 0 ? "−" : "+";
}

function relativeChange(current: number, previous: number): number {
  return ((current - previous) / previous) * PERCENT;
}

/**
 * "+12 % vs. 1,020 previous period" ("−0.4 pt vs. 3.1 % last year" for a
 * rate), `previous` written by `format`; "none over the previous period"
 * when a relative change has nothing to start from.
 */
export function versusText(
  comparison: Compared,
  current: number,
  previous: number,
  format: (value: number) => ComposedTextParam,
  unit: ChangeUnit = "percent",
): ComposedText {
  const key = COMPARISON_KEYS[comparison];
  if (unit === "percent" && previous === 0 && current !== 0) {
    return text(`compare.from_zero.${key}`);
  }
  const change =
    unit === "pt"
      ? Math.round((current - previous) * ONE_DECIMAL) / ONE_DECIMAL
      : previous === 0
        ? 0
        : relativeChange(current, previous);
  const delta =
    unit === "pt"
      ? text("compare.change_points", {
          sign: signOf(change),
          value: Math.abs(change),
        })
      : text("compare.change_percent", {
          sign: signOf(change),
          value: percent(Math.abs(change)),
        });
  return text(`compare.versus.${key}`, { delta, previous: format(previous) });
}

/** A detail line followed by its comparison: "p95 300 ms · +5 % vs. …". */
export function withVersus(
  detail: ComposedText,
  versus: ComposedText | undefined,
): ComposedText {
  return versus ? text("compare.with", { detail, versus }) : detail;
}
