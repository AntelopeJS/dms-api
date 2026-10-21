import { z } from "zod";
import { getBaseConfig, STATISTICS_LIFETIME_DAY_CHOICES } from "@/config";
import { BYTES_PER_KB, type DayStatistics, MS_PER_DAY } from "@/types";
import { isRouteScope, ROUTE_SCOPES } from "./scope";
import type { ApiSettingsPayload, ApiSettingsUpdate } from "./settings";
import { getTodayTimestamp } from "./statistics-utils";

/** Field ids of the settings form: the keys its route reads and answers. */
export const SETTINGS_FIELDS = {
  scope: "scope",
  logRetention: "requestLogRetentionDays",
  statsRetention: "statisticsLifetimeDays",
  maxBody: "requestLogMaxBodyKb",
  headers: "requestLogCaptureHeaders",
  redacted: "redactedKeys",
  slowThreshold: "requestSlownessThresholdMs",
  errorRate: "errorRateWarning",
  downRate: "downErrorRate",
} as const;

/** The two retention fields: the ones whose lowering deletes data. */
export type RetentionField =
  | typeof SETTINGS_FIELDS.logRetention
  | typeof SETTINGS_FIELDS.statsRetention;

export const RETENTION_FIELDS: readonly RetentionField[] = [
  SETTINGS_FIELDS.logRetention,
  SETTINGS_FIELDS.statsRetention,
];

/** Bounds of the editable fields, shared by the form and its route. */
export const SETTINGS_BOUNDS = {
  logRetentionDays: { min: 1, max: 366 },
  maxBodyKb: { min: 0, max: 10_240 },
  slowThresholdMs: { min: 50, max: 600_000, step: 50 },
  capturedHeaders: { max: 50 },
} as const;

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
 * module was started with.
 */
export function moduleDefaults() {
  const base = getBaseConfig();
  return {
    [SETTINGS_FIELDS.logRetention]: msToDays(base.requestLogRetention),
    [SETTINGS_FIELDS.statsRetention]: msToDays(base.statisticsLifetime),
    [SETTINGS_FIELDS.maxBody]: bytesToKb(base.requestLogMaxBodySize),
    [SETTINGS_FIELDS.headers]: [...base.requestLogCaptureHeaders],
    [SETTINGS_FIELDS.slowThreshold]: base.requestSlownessThreshold,
  };
}

/**
 * Each field holding a module default offers it (`offersDefault`), so it
 * shows "Module default · Use default" next to another value; the retentions
 * do not: one click there could shorten a retention, and lowering one deletes
 * data, which the retention field asks to confirm instead.
 */
export function getSettingsFormContext(): SettingsFormContext {
  const defaults = moduleDefaults();
  const retention = new Set<string>(RETENTION_FIELDS);
  return {
    patches: Object.fromEntries(
      Object.entries(defaults)
        .filter(([id]) => !retention.has(id))
        .map(([id, value]) => [
          id,
          { defaultValue: value, offersDefault: true },
        ]),
    ),
  };
}

/** The form's editable values: what is in force, in the units it shows. */
export function editableValues(settings: ApiSettingsPayload) {
  return {
    [SETTINGS_FIELDS.scope]: settings.scope,
    [SETTINGS_FIELDS.logRetention]: msToDays(settings.requestLogRetention),
    [SETTINGS_FIELDS.statsRetention]: msToDays(settings.statisticsLifetime),
    [SETTINGS_FIELDS.maxBody]: bytesToKb(settings.requestLogMaxBodySize),
    [SETTINGS_FIELDS.headers]: settings.requestLogCaptureHeaders,
    [SETTINGS_FIELDS.slowThreshold]: settings.requestSlownessThreshold,
  };
}

/** A header name as HTTP allows it (RFC 9110 token), in lower case. */
const HEADER_NAME = /^[a-z0-9!#$%&'*+.^_`|~-]+$/;

export const INVALID_HEADER_MESSAGE = "$api.settings.capture.invalid_header";
export const SENSITIVE_HEADER_MESSAGE =
  "$api.settings.capture.sensitive_header";

const optionalNumber = (bounds: { min: number; max: number }) =>
  z.number().int().min(bounds.min).max(bounds.max).nullable().optional();

const statisticsLifetimeDays = z
  .number()
  .refine(
    (days) =>
      (STATISTICS_LIFETIME_DAY_CHOICES as readonly number[]).includes(days),
    { message: "$api.settings.retention.statistics_choice" },
  )
  .nullable()
  .optional();

const { slowThresholdMs } = SETTINGS_BOUNDS;

/**
 * The body the settings form sends: every field, `null` for one returned to
 * its module default. Read-only fields are left out, never written.
 */
const settingsBody = z.object({
  [SETTINGS_FIELDS.scope]: z
    .string()
    .refine(isRouteScope, { message: `One of ${ROUTE_SCOPES.join(", ")}` })
    .optional(),
  [SETTINGS_FIELDS.logRetention]: optionalNumber(
    SETTINGS_BOUNDS.logRetentionDays,
  ),
  [SETTINGS_FIELDS.statsRetention]: statisticsLifetimeDays,
  [SETTINGS_FIELDS.maxBody]: optionalNumber(SETTINGS_BOUNDS.maxBodyKb),
  [SETTINGS_FIELDS.slowThreshold]: z
    .number()
    .int()
    .min(slowThresholdMs.min)
    .max(slowThresholdMs.max)
    .multipleOf(slowThresholdMs.step, {
      message: "$api.settings.thresholds.slow_step",
    })
    .nullable()
    .optional(),
  [SETTINGS_FIELDS.headers]: z
    .array(z.string().trim().toLowerCase())
    .max(SETTINGS_BOUNDS.capturedHeaders.max)
    .nullable()
    .optional(),
});

export type SettingsBody = z.infer<typeof settingsBody>;

/** A refused save, as the DMS form shows it under the field it names. */
export interface SettingsFieldError {
  field: string;
  message: string;
  /** The items of a list field refused (the header names to fix). */
  values?: string[];
}

export type SettingsValidation =
  | { ok: true; data: SettingsBody }
  | { ok: false; error: SettingsFieldError | z.ZodIssue[] };

/**
 * Validates the form's body. A header name HTTP does not allow, or one the
 * capture never stores (`authorization`, a cookie…), is refused by name, so
 * the form marks those tags; anything else answers zod's issues, which the
 * form puts under their fields.
 */
export function validateSettings(
  body: unknown,
  isSensitiveHeader: (name: string) => boolean,
): SettingsValidation {
  const parsed = settingsBody.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues };
  const headers = parsed.data[SETTINGS_FIELDS.headers];
  if (headers) {
    const invalid = headers.filter((name) => !HEADER_NAME.test(name));
    if (invalid.length) {
      return {
        ok: false,
        error: {
          field: SETTINGS_FIELDS.headers,
          message: INVALID_HEADER_MESSAGE,
          values: invalid,
        },
      };
    }
    const sensitive = headers.filter(isSensitiveHeader);
    if (sensitive.length) {
      return {
        ok: false,
        error: {
          field: SETTINGS_FIELDS.headers,
          message: SENSITIVE_HEADER_MESSAGE,
          values: sensitive,
        },
      };
    }
  }
  return { ok: true, data: parsed.data };
}

/**
 * What the module configuration sets that the Settings form refuses (45 days
 * of statistics, a 1001 ms threshold, a secret header to capture), as
 * `field: reason` lines: the form could not save such a value back, so the
 * module does not start with it.
 */
export function configErrors(
  config: Omit<ApiSettingsPayload, "scope">,
  isSensitiveHeader: (name: string) => boolean,
): string[] {
  const { [SETTINGS_FIELDS.scope]: _scope, ...values } = editableValues({
    ...config,
    scope: "all",
  });
  const result = validateSettings(values, isSensitiveHeader);
  if (result.ok) return [];
  if (!Array.isArray(result.error)) {
    const { field, message, values: names } = result.error;
    return [`${field}: ${message} (${names?.join(", ")})`];
  }
  return result.error.map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`,
  );
}

/**
 * An override equal to the module default is no override: storing it would
 * pin the value if the default changes later.
 */
function override<T>(
  value: T | null | undefined,
  moduleDefault: T,
  toStored: (value: T) => number | string[],
) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (JSON.stringify(value) === JSON.stringify(moduleDefault)) return null;
  return toStored(value);
}

const days = (value: number) => value * MS_PER_DAY;

/** The validated body as the settings service stores it. */
export function toSettingsUpdate(body: SettingsBody): ApiSettingsUpdate {
  const defaults = moduleDefaults();
  const headers = body[SETTINGS_FIELDS.headers];
  return {
    scope: body[SETTINGS_FIELDS.scope] as ApiSettingsUpdate["scope"],
    requestLogRetention: override(
      body[SETTINGS_FIELDS.logRetention],
      defaults[SETTINGS_FIELDS.logRetention],
      days,
    ) as number | null | undefined,
    statisticsLifetime: override(
      body[SETTINGS_FIELDS.statsRetention],
      defaults[SETTINGS_FIELDS.statsRetention],
      days,
    ) as number | null | undefined,
    requestLogMaxBodySize: override(
      body[SETTINGS_FIELDS.maxBody],
      defaults[SETTINGS_FIELDS.maxBody],
      (kb) => kb * BYTES_PER_KB,
    ) as number | null | undefined,
    requestSlownessThreshold: override(
      body[SETTINGS_FIELDS.slowThreshold],
      defaults[SETTINGS_FIELDS.slowThreshold],
      (ms) => ms,
    ) as number | null | undefined,
    requestLogCaptureHeaders: override(
      headers ? [...new Set(headers)] : headers,
      defaults[SETTINGS_FIELDS.headers],
      (list) => list,
    ) as string[] | null | undefined,
  };
}

/** What the next hourly prune deletes once a retention is set to `days`. */
export interface RetentionImpact {
  /** Days of stored data older than the new retention. */
  days: number;
  /** Requests those days hold: logs, or the calls the day rollups count. */
  requests: number;
}

/** The stores the impact of a retention is read from. */
export interface RetentionImpactStores {
  stats: { getAll(): PromiseLike<Array<{ statistics: DayStatistics[] }>> };
  logs: {
    list(
      filters: { until: Date },
      options: { limit: number; sortDirection: "asc" },
    ): PromiseLike<{ results: Array<{ timestamp: Date }>; total: number }>;
  };
}

/**
 * The statistics a `days` retention prunes: the day rollups before the
 * cutoff `pruneAllStatistics` applies (today's midnight minus the retention).
 */
export async function statisticsRetentionImpact(
  stats: RetentionImpactStores["stats"],
  days: number,
  today: number = getTodayTimestamp(),
): Promise<RetentionImpact> {
  const cutoff = today - days * MS_PER_DAY;
  const prunedDays = new Set<number>();
  let requests = 0;
  for (const route of await stats.getAll()) {
    for (const day of route.statistics) {
      if (day.day >= cutoff) continue;
      prunedDays.add(day.day);
      requests += day.requestsCount;
    }
  }
  return { days: prunedDays.size, requests };
}

/**
 * The request logs a `days` retention prunes: the logs older than the
 * cutoff `pruneRequestLogs` applies, and how many days back they reach.
 */
export async function logRetentionImpact(
  logs: RetentionImpactStores["logs"],
  days: number,
  now: Date = new Date(),
): Promise<RetentionImpact> {
  const cutoff = new Date(now.getTime() - days * MS_PER_DAY);
  const page = await logs.list(
    { until: cutoff },
    { limit: 1, sortDirection: "asc" },
  );
  const oldest = page.results[0]?.timestamp;
  if (!oldest || page.total === 0) return { days: 0, requests: 0 };
  const span = (cutoff.getTime() - new Date(oldest).getTime()) / MS_PER_DAY;
  return { days: Math.max(1, Math.ceil(span)), requests: page.total };
}

/** The settings every page of the console reads (see the summary route). */
export interface SettingsSummary {
  scope: ApiSettingsPayload["scope"];
  /** Routes the scope holds. */
  routes: number;
  requestSlownessThresholdMs: number;
  statisticsLifetimeDays: number;
  requestLogRetentionDays: number;
  /** 0 when body capture is off. */
  requestLogMaxBodyKb: number;
}

export function settingsSummary(
  settings: ApiSettingsPayload,
  routes: number,
): SettingsSummary {
  return {
    scope: settings.scope,
    routes,
    requestSlownessThresholdMs: settings.requestSlownessThreshold,
    statisticsLifetimeDays: msToDays(settings.statisticsLifetime),
    requestLogRetentionDays: msToDays(settings.requestLogRetention),
    requestLogMaxBodyKb: bytesToKb(settings.requestLogMaxBodySize),
  };
}
