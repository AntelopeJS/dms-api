import {
  MS_PER_DAY,
  REQUEST_LOG_DEFAULT_HEADERS,
  REQUEST_LOG_MAX_BODY_BYTES,
  SLOW_REQUEST_THRESHOLD_MS,
  REQUEST_LOG_RETENTION_MS,
} from "./types/constants";

/**
 * The statistics retentions the Settings page offers, in days. 30 keeps the
 * 30D preset but not the period before it, so its comparison is empty; 60
 * keeps both; 90 leaves room for the hour-by-hour prune and is the default.
 */
export const STATISTICS_LIFETIME_DAY_CHOICES = [30, 60, 90] as const;

/** Default statistics retention, in days: one of the choices above. */
export const DEFAULT_STATISTICS_LIFETIME_DAYS = 90;

export interface DmsApiConfig {
  /**
   * Statistics retention window in milliseconds. The Settings page offers 30,
   * 60 or 90 days; a value set here outside those choices still applies.
   */
  statisticsLifetime: number;
  /** Threshold above which a request is flagged as slow, in milliseconds. */
  requestSlownessThreshold: number;
  /** Cap on captured request/response body size in bytes. Bodies above this are stored truncated. */
  requestLogMaxBodySize: number;
  /**
   * Retention window for request logs in milliseconds. Independent of the
   * statistics one: full requests weigh far more than the day rollups.
   */
  requestLogRetention: number;
  /** Allow-list of header names captured in request logs (lower-case). */
  requestLogCaptureHeaders: string[];
  /** Regex sources matched against middleware callbackName to flag auth handlers. */
  authMiddlewareNamePatterns: string[];
  /** Exact middleware callbackName values to flag as auth handlers, alongside the patterns. */
  authMiddlewareCallbacks: string[];
  /**
   * Base URL clients reach the API at, for the snippets the console hands
   * out (`https://api.example.com`). Unset, the origin of the request.
   */
  publicApiUrl?: string;
  /**
   * Key the Tester's tokens are signed with (see `services/tester-source.ts`).
   * Set the same value on every instance behind one console; unset, each
   * instance draws its own at start.
   */
  testerSourceSecret?: string;
}

const DEFAULT_CONFIG: DmsApiConfig = {
  statisticsLifetime: DEFAULT_STATISTICS_LIFETIME_DAYS * MS_PER_DAY,
  requestSlownessThreshold: SLOW_REQUEST_THRESHOLD_MS,
  requestLogMaxBodySize: REQUEST_LOG_MAX_BODY_BYTES,
  requestLogRetention: REQUEST_LOG_RETENTION_MS,
  requestLogCaptureHeaders: [...REQUEST_LOG_DEFAULT_HEADERS],
  authMiddlewareNamePatterns: ["^auth_", "^requireAuth", "^session_"],
  authMiddlewareCallbacks: [],
};

let baseConfig: DmsApiConfig = DEFAULT_CONFIG;
let globalConfig: DmsApiConfig = DEFAULT_CONFIG;
let runtimeOverrides: Partial<DmsApiConfig> = {};

/**
 * `layer` over `base`, key by key: a key `layer` leaves undefined falls
 * through. Not `defu`, which concatenates arrays: a header allow-list set to
 * two headers would have kept the eight defaults on top of them.
 */
function overlay(
  layer: Partial<DmsApiConfig>,
  base: DmsApiConfig,
): DmsApiConfig {
  const defined = Object.fromEntries(
    Object.entries(layer).filter(([, value]) => value !== undefined),
  );
  return { ...base, ...defined };
}

function mergeEffective(): void {
  globalConfig = overlay(runtimeOverrides, baseConfig);
}

export function setConfig(input?: Partial<DmsApiConfig>): void {
  baseConfig = overlay(input ?? {}, DEFAULT_CONFIG);
  mergeEffective();
}

/**
 * Runtime overrides persisted from the Settings page. They sit on top of the
 * module config passed to `construct` — undefined keys fall through to it.
 */
export function applyConfigOverrides(overrides: Partial<DmsApiConfig>): void {
  runtimeOverrides = overrides;
  mergeEffective();
}

export function getConfig(): DmsApiConfig {
  return globalConfig;
}

/** The configuration the module was started with, without the overrides. */
export function getBaseConfig(): DmsApiConfig {
  return baseConfig;
}
