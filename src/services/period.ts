import { getConfig } from "@/config";
import {
  MAX_HOURLY_HOURS,
  MAX_MINUTELY_MINUTES,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  STATISTICS_RETENTION_MS,
} from "@/types";

/**
 * Shared parsing for the `period` query parameter of the monitoring
 * endpoints. Every window is clamped to what is actually still stored:
 * asking beyond the retention only ever yields empty buckets, and the
 * retention is configurable from the Settings page (1 to 366 days), so the
 * ceiling is read from the config rather than hard-coded per endpoint.
 */

/**
 * Longest day window the rollups can answer. The prune cron drops
 * `statistics[]` entries older than `statisticsLifetime`, so that setting is
 * the horizon.
 */
export function getMaxStatsDays(): number {
  return Math.max(1, Math.round(retention("statisticsLifetime") / MS_PER_DAY));
}

/**
 * A retention window from the config, guarded. `Math.max(1, NaN)` is NaN, so
 * a non-numeric config value would survive every bound below and leave `NaN`
 * as the resolved period rather than failing; fall back to what the module
 * ships with instead.
 */
function retention(key: "statisticsLifetime" | "requestLogRetention"): number {
  const ms = getConfig()[key];
  return Number.isFinite(ms) && ms > 0 ? ms : STATISTICS_RETENTION_MS;
}

/**
 * Longest day window the raw request logs can answer. The Logs page reads
 * those rows directly rather than the day rollups, so it answers to
 * `requestLogRetention` — a separate setting from the statistics one, and the
 * ceiling its own period filter has to respect.
 */
export function getMaxLogDays(): number {
  return Math.max(1, Math.round(retention("requestLogRetention") / MS_PER_DAY));
}

/**
 * Sub-day windows are served from the raw request logs, not the day rollups,
 * so they answer to `requestLogRetention` instead — bounded further by the
 * chart point budget the aggregation itself enforces.
 */
export function getMaxLogMinutes(): number {
  return clampWindow(
    retention("requestLogRetention") / MS_PER_MINUTE,
    MAX_MINUTELY_MINUTES,
  );
}

export function getMaxLogHours(): number {
  return clampWindow(
    retention("requestLogRetention") / MS_PER_HOUR,
    MAX_HOURLY_HOURS,
  );
}

function clampWindow(available: number, ceiling: number): number {
  return Math.max(1, Math.min(ceiling, Math.floor(available)));
}

/**
 * `Nd` → day count, clamped to the statistics retention. Anything that is not
 * a positive day window yields undefined; callers that treat that as "no
 * filter at all" use this directly, the ones that need a default want
 * {@link resolvePeriodDays}.
 */
export function parsePeriodDays(period?: string): number | undefined {
  if (!period) return undefined;
  const m = period.match(/^(\d+)d$/);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  if (n <= 0) return undefined;
  return Math.min(n, getMaxStatsDays());
}

/**
 * Same, but falls back to `fallback` when `period` names no usable window.
 * The fallback is clamped too — a 7-day default would otherwise chart four
 * empty days against a 3-day retention.
 */
export function resolvePeriodDays(
  period: string | undefined,
  fallback: number,
): number {
  return parsePeriodDays(period) ?? Math.min(fallback, getMaxStatsDays());
}

/**
 * Period parser that also picks the chart granularity. Accepts:
 *   - `Nm` (minutes), or `1h` → minute buckets
 *   - `Nh` (hours, N≥2) → hour buckets
 *   - `Nd` (days) → day buckets
 *
 * Picking the granularity automatically keeps the chart readable: 1h gives
 * 60 minute-buckets rather than collapsing to a single point.
 */
export interface ParsedPeriod {
  granularity: "minute" | "hour" | "day";
  count: number;
}

export function parsePeriod(period?: string): ParsedPeriod | undefined {
  if (!period) return undefined;
  const m = period.match(/^(\d+)([mhd])$/);
  if (!m) return undefined;
  const count = parseInt(m[1], 10);
  if (count <= 0) return undefined;
  if (m[2] === "m") {
    return {
      granularity: "minute",
      count: Math.min(count, getMaxLogMinutes()),
    };
  }
  if (m[2] === "h") {
    // 1h gets minute-level granularity so the chart has 60 points instead of 1.
    if (count === 1) {
      return { granularity: "minute", count: Math.min(60, getMaxLogMinutes()) };
    }
    return { granularity: "hour", count: Math.min(count, getMaxLogHours()) };
  }
  return { granularity: "day", count: Math.min(count, getMaxStatsDays()) };
}
