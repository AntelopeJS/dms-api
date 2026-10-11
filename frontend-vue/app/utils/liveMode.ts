// The live mode of the monitoring pages (Overview, Request logs, Routes): one
// Live / Pause control per page (`LiveControl`), Live by default. Live, the
// page follows the live feed the capture publishes and asks its blocks to
// read their data again (the DMS page refresh), no more often than its own
// pace; paused, nothing moves and the control counts what arrives. A hidden
// tab or typing in the Tester pause it by themselves, and say why. What is
// here holds no state and touches no DOM: the rules, tested alone.

/** Realtime topic of the live feed (`LIVE_REQUESTS_TOPIC` on the server). */
export const LIVE_TOPIC = 'api:monitor:requests'

/** Where the user's choice is kept, one for the three pages. */
export const LIVE_STORAGE_KEY = 'dms-api:live'

export type LivePage = 'logs' | 'overview' | 'routes'

/**
 * Why the page paused by itself, most telling first: the first one is the one
 * named.
 */
export const PAUSE_REASONS = ['hidden', 'tester'] as const
export type PauseReason = (typeof PAUSE_REASONS)[number]

/** Live, paused by the user, or paused by what the user is doing. */
export type LiveMode = 'live' | 'paused' | 'auto'

export interface LiveInputs {
  userPaused: boolean
  reasons: readonly PauseReason[]
  /**
   * The reasons the user chose Live over (`reasonsKey`): an automatic pause
   * the user lifted stays lifted until its causes change.
   */
  override: string | null
}

export interface LiveStatus {
  mode: LiveMode
  /** Why the page is paused by itself; none when live or paused by hand. */
  reason: PauseReason | null
}

/** The reasons in their order, deduplicated. */
export function sortedReasons(reasons: readonly PauseReason[]): PauseReason[] {
  return PAUSE_REASONS.filter((reason) => reasons.includes(reason))
}

/** The reasons as one key, whatever their order. */
export function reasonsKey(reasons: readonly PauseReason[]): string {
  return sortedReasons(reasons).join(',')
}

/**
 * Where the page stands. A hidden tab always stops it, even against an
 * override: nobody sees it. The user's own pause comes next: it outlives the
 * automatic ones, which lift when their cause goes.
 */
export function liveStatus(inputs: LiveInputs): LiveStatus {
  const reasons = sortedReasons(inputs.reasons)
  if (reasons[0] === 'hidden') return { mode: 'auto', reason: 'hidden' }
  if (inputs.userPaused) return { mode: 'paused', reason: null }
  if (reasons.length === 0 || inputs.override === reasonsKey(reasons))
    return { mode: 'live', reason: null }
  return { mode: 'auto', reason: reasons[0] }
}

/** A verdict changed during a pause: the one on screen, and the one now. */
export interface VerdictChange {
  from: string
  to: string
}

/**
 * What the pause hides of the API's health: the verdict read while paused,
 * when it is no longer the one on screen.
 */
export function verdictChange(
  shown: string | null,
  latest: string | null,
): VerdictChange | null {
  return shown && latest && shown !== latest
    ? { from: shown, to: latest }
    : null
}

/** The kept choice: paused only when the user said so. */
export function storedPaused(value: string | null | undefined): boolean {
  return value === 'paused'
}

/** `?live=0` freezes a shared view, whatever the reader's own choice. */
export function urlPaused(query: Record<string, unknown>): boolean {
  const value = query.live
  return (Array.isArray(value) ? value[0] : value) === '0'
}

const SECOND = 1000
const LONG_WINDOWS = new Set(['7d', '30d'])

/**
 * The page's pace, the least time between two refreshes in ms: the request
 * logs every 5 s; the Overview every 10 s over a day, every 30 s over a week
 * or a month, where only today's bucket moves; Routes every 15 s, every 30 s
 * over a week or a month.
 */
export function liveCadence(page: LivePage, window?: string): number {
  const long = !!window && LONG_WINDOWS.has(window)
  switch (page) {
    case 'logs':
      return 5 * SECOND
    case 'overview':
      return long ? 30 * SECOND : 10 * SECOND
    case 'routes':
      return long ? 30 * SECOND : 15 * SECOND
  }
}

/** Live, a page with no message for this long refreshes anyway. */
export const MAX_IDLE_MS = 60 * SECOND
/** Paused, how often the count of new requests is read. */
export const COUNT_POLL_MS = 30 * SECOND
/**
 * Least time between two counts, however many messages arrive: paused, the
 * count stays light, every 15 to 30 s.
 */
export const COUNT_MIN_GAP_MS = 15 * SECOND

export interface PacerClock {
  now: () => number
  set: (run: () => void, ms: number) => ReturnType<typeof setTimeout>
  clear: (timer: ReturnType<typeof setTimeout>) => void
}

const realClock: PacerClock = {
  now: () => Date.now(),
  set: (run, ms) => setTimeout(run, ms),
  clear: (timer) => clearTimeout(timer),
}

export interface Pacer {
  /** Runs now if the floor allows it, else once when it does. */
  request: () => void
  /** Runs now, whatever the floor. */
  force: () => void
  /** Drops a run waiting for the floor. */
  cancel: () => void
  /** Counts as a run now, without running: what was just loaded. */
  touch: () => void
  /** Whether a run waits for the floor. */
  waiting: () => boolean
  /** When it last ran; 0 before. */
  last: () => number
}

/**
 * Runs `run` on request, never twice within `floorMs`: requests arriving in
 * between are folded into one run at the end of the floor.
 */
export function createPacer(
  floorMs: () => number,
  run: () => void,
  clock: PacerClock = realClock,
): Pacer {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  function fire() {
    timer = null
    last = clock.now()
    run()
  }

  function cancel() {
    if (timer !== null) clock.clear(timer)
    timer = null
  }

  return {
    request() {
      if (timer !== null) return
      const wait = last + floorMs() - clock.now()
      if (wait <= 0) fire()
      else timer = clock.set(fire, wait)
    },
    force() {
      cancel()
      fire()
    },
    cancel,
    touch() {
      last = clock.now()
    },
    waiting: () => timer !== null,
    last: () => last,
  }
}

/** What arrived since the rows on screen, as `/logs/…/since` counts it. */
export interface PendingCount {
  /** API requests, the Tester's left out. */
  count: number
  serverErrors: number
  /** Requests the Tester sent, counted apart. */
  tester: number
}

export const NO_PENDING: PendingCount = { count: 0, serverErrors: 0, tester: 0 }

function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0
}

/** The counts of a `/since` answer, whatever it holds. */
export function pendingFrom(answer: unknown): PendingCount {
  const value = (answer ?? {}) as Record<string, unknown>
  return {
    count: countOf(value.count),
    serverErrors: countOf(value.serverErrors),
    tester: countOf(value.tester),
  }
}

export function hasPending(pending: PendingCount): boolean {
  return pending.count > 0 || pending.tester > 0
}

/** The latest of ISO timestamps, unreadable ones left out. */
export function latestTime(
  values: Array<string | null | undefined>,
): string | null {
  let latest: number | null = null
  for (const value of values) {
    const time = value ? Date.parse(value) : Number.NaN
    if (!Number.isNaN(time) && (latest === null || time > latest)) latest = time
  }
  return latest === null ? null : new Date(latest).toISOString()
}

/** The request logs' URL filters, which its table reads (`?route=`…). */
const LOGS_URL_FILTERS = ['route', 'path', 'error', 'slow', 'method'] as const

/**
 * An incident's range on the logs page (`?since=` / `?until=`), as the
 * table's route reads it (`filter_from` / `filter_to`): a view ending in the
 * past counts nothing new.
 */
const LOGS_URL_RANGE = { since: 'from', until: 'to' } as const

function single(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' && first !== '' ? first : undefined
}

export interface SinceInputs {
  page: LivePage
  after: string
  /** The page's URL query, the filters its table follows. */
  query: Record<string, unknown>
  /** Query key of the selected route (Routes). */
  routeKey?: string
}

/**
 * The query counting what arrived after the screen was last brought up to
 * date, under the page's URL filters: the logs page's filters and range, the
 * selected route on Routes, nothing on the Overview. `limit=0`: counted, not
 * read.
 */
export function sinceQuery(inputs: SinceInputs): URLSearchParams {
  const params = new URLSearchParams({ after: inputs.after, limit: '0' })
  if (inputs.page === 'logs') {
    for (const key of LOGS_URL_FILTERS) {
      const value = single(inputs.query[key])
      if (value) params.set(`filter_${key}`, `is:${value}`)
    }
    for (const [key, field] of Object.entries(LOGS_URL_RANGE)) {
      const value = single(inputs.query[key])
      if (value) params.set(`filter_${field}`, `is:${value}`)
    }
  }
  if (inputs.page === 'routes' && inputs.routeKey) {
    const route = single(inputs.query[inputs.routeKey])
    if (route) params.set('filter_route', `is:${route}`)
  }
  return params
}

interface ClosestTarget {
  closest?: (selector: string) => unknown
}

const TYPING_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

/** Whether a key went to a field: a shortcut must not take it. */
export function isTypingTarget(target: unknown): boolean {
  const element = target as ClosestTarget | null
  return (
    typeof element?.closest === 'function' && !!element.closest(TYPING_SELECTOR)
  )
}

/** The key toggling Live / Pause: a bare `L`. */
export function isLiveShortcut(event: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  repeat?: boolean
  target: unknown
}): boolean {
  return (
    event.key.toLowerCase() === 'l' &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.repeat &&
    !isTypingTarget(event.target)
  )
}
