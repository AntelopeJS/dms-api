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

/**
 * Default retention of the request logs in milliseconds (30 days): logs older
 * than this are pruned every hour. The statistics have their own retention.
 */
export const REQUEST_LOG_RETENTION_MS = 2_592_000_000;

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

/**
 * Path prefixes of the traffic the console does not capture: its own
 * endpoints (polled by every open page), the DMS realtime channel and the
 * DMS's own `/dms/*` endpoints. Counting them would make the dashboard watch
 * itself and drown the API's traffic under the console's.
 */
export const INTERNAL_PATH_PREFIXES = [
  MONITORING_API_PREFIX,
  "/api/realtime",
  "/dms",
] as const;

/**
 * Last segment of the page layout route the DMS registers for every page
 * (`<page>/pagelayout`), called by the DMS frontend to draw a page: internal
 * traffic too, whichever module declared the page.
 */
export const INTERNAL_ROUTE_SUFFIX = "/pagelayout";

/**
 * Header the Tester marks its calls with: a token the server signs (see
 * `services/tester-source.ts`). Not `x-dms-*`: the DMS frontend's proxy
 * strips those before forwarding. Never stored with the captured headers.
 */
export const TESTER_SOURCE_HEADER = "x-antelopejs-api-source";

/** Header a request names its own id in, stored to find the request again. */
export const REQUEST_ID_HEADER = "x-request-id";

/** Longest `x-request-id` value stored; longer ones are not ids. */
export const REQUEST_ID_MAX_LENGTH = 128;

/**
 * Largest page of the request table's route. The DMS table loads more rows
 * by asking again from the first row with a larger limit, so this bounds what
 * "Load more" can reach: 100 clicks of 50 rows.
 */
export const REQUEST_LOG_LIST_MAX_ROWS = 5000;

/**
 * Realtime topic the console's live mode listens on: the capture publishes on
 * it what it logged since its last message (see `services/live-feed.ts`), and
 * the Overview, Request logs and Routes pages are bound to it.
 */
export const LIVE_REQUESTS_TOPIC = "api:monitor:requests";

/** Type of the messages published on {@link LIVE_REQUESTS_TOPIC}. */
export const LIVE_REQUESTS_EVENT = "requests";

/**
 * Least time between two messages on {@link LIVE_REQUESTS_TOPIC}. The DMS
 * debounces what it receives (180 ms, restarted by each event) and a page
 * refreshes on each message: one per request would never settle.
 */
export const LIVE_BATCH_MS = 1_500;
