import type {
  AuthMode,
  BodyMode,
  TesterErrorCode,
} from '../../../utils/testerRequest'

/**
 * A read the tester runs when it needs it (a replay, a lookup after a call),
 * in the browser only and never again on the page's refreshes.
 */
const ON_DEMAND = {
  immediate: false,
  server: false,
  watch: false,
  refreshOnPageRefresh: false,
} as const

/** The tester's own reads of the request logs: by its permission, not the request logs page's. */
const LOGS_API = '/api/monitoring/logs/tester'

const LOGS_PAGE = '/modules/api/logs'

/**
 * Abort reason of a call left behind by a route change: filed under its
 * route as abandoned, since the API may have received it.
 */
const ROUTE_CHANGED = 'route-changed'

/** The capture is written once the answer is sent: looked for twice. */
const CAPTURE_DELAYS_MS = [400, 1500]

/** A captured call older than this is not the one just sent. */
const CAPTURE_MATCH_MS = 60_000

/** An id as long as a real one, to size the request before sending it. */
const SIZE_PROBE_ID = '00000000-0000-0000-0000-000000000000'

const DRAFT_SAVE_DELAY_MS = 250

const BODY_MODES: BodyMode[] = ['json', 'text', 'form', 'none']

const AUTH_ICONS: Record<AuthMode, string> = {
  session: 'i-ph-user-check',
  manual: 'i-ph-key',
  none: 'i-ph-lock-simple-open',
}

const ERROR_ICONS: Partial<Record<TesterErrorCode, string>> = {
  invalid_input: 'i-ph-prohibit',
  body_too_large: 'i-ph-file-x',
  not_authenticated: 'i-ph-sign-in',
  not_owner: 'i-ph-lock-simple',
  cross_origin: 'i-ph-shield-warning',
  response_too_large: 'i-ph-file-x',
  timeout: 'i-ph-timer',
  aborted: 'i-ph-x-circle',
}

/**
 * Error texts that send to the Captured tab: another text on a route the
 * module does not capture.
 */
const POINTS_TO_CAPTURED: ReadonlySet<string> = new Set([
  'proxy_failed',
  'timeout',
  'aborted',
  'abandoned',
])

/** The tester's constants, as `useTesterState` hands them to its flows. */
export const TESTER_CONSTANTS = {
  ON_DEMAND,
  LOGS_API,
  LOGS_PAGE,
  ROUTE_CHANGED,
  CAPTURE_DELAYS_MS,
  CAPTURE_MATCH_MS,
  SIZE_PROBE_ID,
  DRAFT_SAVE_DELAY_MS,
  BODY_MODES,
  AUTH_ICONS,
  ERROR_ICONS,
  POINTS_TO_CAPTURED,
}
