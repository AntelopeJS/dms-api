// =============================================================================
// Database Configuration
// =============================================================================

/** Prefix of the console's own HTTP routes. */
export const MONITORING_API_PREFIX = "/api/monitoring";

/** Database schema name for dms-api tables */
export const SCHEMA_NAME = "dms-api";

// =============================================================================
// Statistics Settings
// =============================================================================

/** Milliseconds in one minute. */
export const MS_PER_MINUTE = 60_000;

/** Milliseconds in one hour. */
export const MS_PER_HOUR = 3_600_000;

/** Milliseconds in one day. */
export const MS_PER_DAY = 86_400_000;

/** Error rate (0-1) above which a route/summary is flagged as elevated. */
export const ELEVATED_ERROR_RATE = 0.05;

/** Error rate (0-1) above which the summary health is reported as "down". */
export const CRITICAL_ERROR_RATE = 0.2;

/** Default statistics retention period in milliseconds (30 days) */
export const STATISTICS_RETENTION_MS = 2_592_000_000;

/** Threshold in milliseconds to consider a request as slow (1 second) */
export const SLOW_REQUEST_THRESHOLD_MS = 1000;

/** Conversion factor from nanoseconds to milliseconds */
export const NS_TO_MS = 1_000_000;

/** Default HTTP status code when status cannot be determined */
export const HTTP_STATUS_OK = 200;

// =============================================================================
// Request Log Settings
// =============================================================================

/** Bytes in one kilobyte, the unit the settings show body sizes in. */
export const BYTES_PER_KB = 1024;

/** Default cap for captured request/response body size in bytes (64 KiB) */
export const REQUEST_LOG_MAX_BODY_BYTES = 65_536;

/** Default header allow-list for request log capture (lower-case) */
export const REQUEST_LOG_DEFAULT_HEADERS = [
  "content-type",
  "content-length",
  "user-agent",
  "accept",
  "accept-encoding",
  "host",
  "referer",
  "origin",
] as const;

/** Content-types whose bodies are safe to capture as text */
export const REQUEST_LOG_TEXT_CONTENT_TYPE_PREFIXES = [
  "application/json",
  "application/xml",
  "application/x-www-form-urlencoded",
  "text/",
] as const;
