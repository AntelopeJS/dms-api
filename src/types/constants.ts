// =============================================================================
// Database Configuration
// =============================================================================

/** Database schema name for dms-api tables */
export const SCHEMA_NAME = "dms-api";

// =============================================================================
// Statistics Settings
// =============================================================================

/** Milliseconds in one second. */
export const MS_PER_SECOND = 1000;

/** Milliseconds in one minute. */
export const MS_PER_MINUTE = 60_000;

/** Milliseconds in one hour. */
export const MS_PER_HOUR = 3_600_000;

/** Milliseconds in one day. */
export const MS_PER_DAY = 86_400_000;

/** Maximum number of days accepted by a `Nd` period parameter. */
export const MAX_PERIOD_DAYS = 90;

/** Maximum minute-bucket history window, in minutes. */
export const MAX_MINUTELY_MINUTES = 6 * 60;

/** Maximum hour-bucket history window, in hours. */
export const MAX_HOURLY_HOURS = 14 * 24;

/** Error rate (0-1) above which a route/summary is flagged as elevated. */
export const ELEVATED_ERROR_RATE = 0.05;

/** Error rate (0-1) above which the summary health is reported as "down". */
export const CRITICAL_ERROR_RATE = 0.2;

/** Slow-route count above which the summary health is reported as "degraded". */
export const DEGRADED_SLOW_ROUTES = 5;

/** Default statistics retention period in milliseconds (30 days) */
export const STATISTICS_RETENTION_MS = 2_592_000_000;

/** Number of days to display in statistics charts */
export const STATISTICS_CHART_DAYS = 7;

/**
 * Maximum number of plotted buckets per statistics chart. Longer windows group
 * consecutive days together rather than adding points, so the route Statistics
 * charts — rendered two-up in a half-width column — stay legible at 30d+.
 */
export const MAX_CHART_BUCKETS = 14;

/** Threshold in milliseconds to consider a request as slow (1 second) */
export const SLOW_REQUEST_THRESHOLD_MS = 1000;

/** Conversion factor from nanoseconds to milliseconds */
export const NS_TO_MS = 1_000_000;

/** Default HTTP status code when status cannot be determined */
export const HTTP_STATUS_OK = 200;

// =============================================================================
// Request Log Settings
// =============================================================================

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

// =============================================================================
// UI Icons (Phosphor Icons)
// =============================================================================

/** Icon mapping for HTTP methods in tree view */
export const HTTP_METHOD_ICONS = {
  GET: "i-ph-download-simple",
  POST: "i-ph-plus-circle",
  PUT: "i-ph-pencil-simple",
  DELETE: "i-ph-trash",
  PATCH: "i-ph-note-pencil",
  HEAD: "i-ph-link",
  OPTIONS: "i-ph-link",
  CONNECT: "i-ph-link",
  TRACE: "i-ph-link",
} as const;
