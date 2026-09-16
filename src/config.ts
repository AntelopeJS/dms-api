import { defu } from "defu";
import {
  REQUEST_LOG_DEFAULT_HEADERS,
  REQUEST_LOG_MAX_BODY_BYTES,
  SLOW_REQUEST_THRESHOLD_MS,
  STATISTICS_RETENTION_MS,
} from "./types/constants";

export interface DmsApiConfig {
  /** Statistics retention window in milliseconds. */
  statisticsLifetime: number;
  /** Threshold above which a request is flagged as slow, in milliseconds. */
  requestSlownessThreshold: number;
  /** Cap on captured request/response body size in bytes. Bodies above this are stored truncated. */
  requestLogMaxBodySize: number;
  /** Retention window for request logs in milliseconds. Defaults to statisticsLifetime if omitted. */
  requestLogRetention: number;
  /** Allow-list of header names captured in request logs (lower-case). */
  requestLogCaptureHeaders: string[];
  /** Regex sources matched against middleware callbackName to flag auth handlers. */
  authMiddlewareNamePatterns: string[];
  /** Exact middleware callbackName values to flag as auth handlers, alongside the patterns. */
  authMiddlewareCallbacks: string[];
}

const DEFAULT_CONFIG: DmsApiConfig = {
  statisticsLifetime: STATISTICS_RETENTION_MS,
  requestSlownessThreshold: SLOW_REQUEST_THRESHOLD_MS,
  requestLogMaxBodySize: REQUEST_LOG_MAX_BODY_BYTES,
  requestLogRetention: STATISTICS_RETENTION_MS,
  requestLogCaptureHeaders: [...REQUEST_LOG_DEFAULT_HEADERS],
  authMiddlewareNamePatterns: ["^auth_", "^requireAuth", "^session_"],
  authMiddlewareCallbacks: [],
};

let baseConfig: DmsApiConfig = DEFAULT_CONFIG;
let globalConfig: DmsApiConfig = DEFAULT_CONFIG;
let runtimeOverrides: Partial<DmsApiConfig> = {};

function mergeEffective(): void {
  globalConfig = defu(runtimeOverrides, baseConfig);
}

export function setConfig(input?: Partial<DmsApiConfig>): void {
  const merged = defu(input ?? {}, DEFAULT_CONFIG);
  if (input?.requestLogRetention === undefined) {
    merged.requestLogRetention = merged.statisticsLifetime;
  }
  baseConfig = merged;
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
