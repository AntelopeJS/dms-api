import { getBaseConfig } from "@/config";
import { BYTES_PER_KB, MS_PER_DAY } from "@/types";

/** What the settings form learns per request, by field id. */
export interface SettingsFormContext {
  patches: Record<string, Record<string, unknown>>;
}

export function msToDays(ms: number): number {
  return Math.max(1, Math.round(ms / MS_PER_DAY));
}

export function bytesToKb(bytes: number): number {
  return Math.round(bytes / BYTES_PER_KB);
}

/**
 * The module defaults of the overridable fields, from the configuration the
 * module was started with: the form shows "Module default · Use default"
 * next to a field holding something else.
 */
export function moduleDefaults() {
  const base = getBaseConfig();
  return {
    requestLogRetentionDays: msToDays(base.requestLogRetention),
    statisticsLifetimeDays: msToDays(base.statisticsLifetime),
    requestLogMaxBodyKb: bytesToKb(base.requestLogMaxBodySize),
    requestLogCaptureHeaders: [...base.requestLogCaptureHeaders],
    requestSlownessThresholdMs: base.requestSlownessThreshold,
  };
}

export function getSettingsFormContext(): SettingsFormContext {
  const defaults = moduleDefaults();
  return {
    patches: Object.fromEntries(
      Object.entries(defaults).map(([id, value]) => [
        id,
        { defaultValue: value },
      ]),
    ),
  };
}
