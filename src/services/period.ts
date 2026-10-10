import { getConfig } from "@/config";
import { MS_PER_DAY, STATISTICS_RETENTION_MS } from "@/types";

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
