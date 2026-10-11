import { DEFAULT_STATISTICS_LIFETIME_DAYS, getConfig } from "@/config";
import { MS_PER_DAY, REQUEST_LOG_RETENTION_MS } from "@/types";

/**
 * How far back the monitoring data reaches. Every window is clamped to what
 * is actually still stored (see `window.ts`): asking beyond the retention only
 * ever yields empty buckets, and the retention is configurable from the
 * Settings page, so the ceiling is read from the config rather than
 * hard-coded per endpoint.
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
  if (Number.isFinite(ms) && ms > 0) return ms;
  return key === "statisticsLifetime"
    ? DEFAULT_STATISTICS_LIFETIME_DAYS * MS_PER_DAY
    : REQUEST_LOG_RETENTION_MS;
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
