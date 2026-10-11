// How a request table opens a request in the panel on the right.
//
// A DMS drawer target slides up from the bottom and takes no side, and a
// drawer opened with `useDrawer()` lists the table under it again (its
// container reads the DMS route, whose query the table's filters watch). So
// the request opens in the DMS side panel instead (`registerSidePanel`):
// docked next to the page from `lg`, which shrinks to make room and stays
// clickable, a sheet over it below. A row's action is a page target,
// `?open-request=<id>` on the page it is on (`src/pages/request-table.ts`),
// which the middleware below stops: it writes `?record=<id>` into the URL the
// page already has (its route, its filters, its tab) without a visit, and
// tells the page's `RequestDrawerHost` block, which opens the panel on it.
// `?record=` is also the deep link: a link or a reload opens it.
//
// History: opening, stepping and closing all rewrite the current entry in
// place (`writeRecord`), never add one. An entry pushed for the panel makes
// Back and Forward traverse between two entries of the same page, and
// Inertia answers every traverse by mounting the page anew from its history
// state: every block lists again, the loaded rows, the pause and the focus
// are lost. Stopping the `popstate` does not prevent it. The trade-off: Back
// leaves the page, it does not close the panel; a reload or a shared link
// still opens the request.

type Query = Record<string, string>

interface RouteLike {
  path: string
  query: Query
}

/** Query key a row action names the request it opens under. */
export const OPEN_REQUEST_KEY = 'open-request'

/** Query key of the request the page has open: the deep link. */
export const RECORD_KEY = 'record'

/** Window event a row opening a request sends (`OpenRequestDetail`). */
export const OPEN_REQUEST_EVENT = 'dms-api:open-request'

export interface OpenRequestDetail {
  id: string
}

/** Id of the DMS side panel the requests open in. */
export const REQUEST_PANEL_ID = 'dms-api-request'

/**
 * The panel, as `registerSidePanel` takes it (`plugins/requestPanel.ts`).
 * The DMS docks it from 1 024 px and takes its width in px, not as a CSS
 * length: 420 px leaves a 1 280 px laptop 620 px of page next to the
 * sidebar, enough for a request table's time, method, path, status and
 * duration. A wider panel is a drag of its handle away, and remembered.
 */
export const REQUEST_PANEL = {
  id: REQUEST_PANEL_ID,
  // `RequestDetail.vue`, under the module's component prefix.
  component: 'DmsApiRequestDetail',
  ariaLabel: '$api.request.panel_label',
  defaultWidth: 420,
  minWidth: 360,
  maxWidth: 960,
}

/**
 * Icon of the request tables' row action (`src/pages/request-table.ts`). The
 * DMS names a row's inline action button `row-action-<row id>-<icon>`: the
 * panel finds the rows, their order and their ids by it, whatever columns the
 * table shows.
 */
export const REQUEST_ACTION_ICON = 'i-ph-sidebar-simple'

const ACTION_ID_PREFIX = 'row-action-'
const ACTION_ID_SUFFIX = `-${REQUEST_ACTION_ICON}`

/** The buttons opening a request, one per row of a request table. */
export const REQUEST_ACTION_SELECTOR = `button[id^="${ACTION_ID_PREFIX}"][id$="${ACTION_ID_SUFFIX}"]`

/** The request a row's action button opens, from its id. */
export function requestOfActionId(id: string | null): string | null {
  if (!id?.startsWith(ACTION_ID_PREFIX) || !id.endsWith(ACTION_ID_SUFFIX))
    return null
  const request = id.slice(ACTION_ID_PREFIX.length, -ACTION_ID_SUFFIX.length)
  return request || null
}

/** The selector of the action button of the row of `id`. */
export function requestActionSelector(id: string): string {
  const escaped = id.replace(/["\\]/g, '\\$&')
  return `button[id="${ACTION_ID_PREFIX}${escaped}${ACTION_ID_SUFFIX}"]`
}

/** The requests the tables under `root` show, in their order, once each. */
export function listedRequestIds(root: ParentNode): string[] {
  const ids = new Set<string>()
  for (const button of root.querySelectorAll(REQUEST_ACTION_SELECTOR)) {
    const id = requestOfActionId(button.getAttribute('id'))
    if (id) ids.add(id)
  }
  return [...ids]
}

/** `query` with `id` as its open request, or with none. */
export function withRecord(query: Query, id?: string): Query {
  const { [RECORD_KEY]: _open, [OPEN_REQUEST_KEY]: _asked, ...rest } = query
  return id ? { ...rest, [RECORD_KEY]: id } : rest
}

/** The request the URL has open, if any. */
export function readRecord(query: Record<string, unknown>): string | null {
  const value = query[RECORD_KEY]
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * The visit a row's `?open-request=` stands for: the same page with its query
 * kept and the request open. Undefined for any other visit. A row opening a
 * request on another page (or a link carrying the key) opens it there.
 */
export function openRequestRedirect(
  to: RouteLike,
  from: RouteLike,
): { path: string; query: Query } | undefined {
  const id = to.query[OPEN_REQUEST_KEY]
  if (typeof id !== 'string' || id === '') return undefined
  const kept = to.path === from.path ? { ...from.query, ...to.query } : to.query
  return { path: to.path, query: withRecord(kept, id) }
}

/** The request the browser's URL has open, if any. */
export function readLocationRecord(href: string): string | null {
  return readRecord(Object.fromEntries(new URL(href).searchParams))
}

/** `href` with `id` as its open request, or with none. */
export function hrefWithRecord(href: string, id?: string): string {
  const url = new URL(href)
  url.searchParams.delete(OPEN_REQUEST_KEY)
  if (id) url.searchParams.set(RECORD_KEY, id)
  else url.searchParams.delete(RECORD_KEY)
  return url.href
}

/**
 * Opens `id` in the browser's URL, or closes the request it has open, in the
 * current history entry: no visit, no entry, so no traverse Inertia would
 * answer by mounting the page anew. Inertia's state of the entry is kept as
 * it is, scroll positions included.
 */
export function writeRecord(id?: string) {
  window.history.replaceState(
    window.history.state,
    '',
    hrefWithRecord(window.location.href, id),
  )
}

/**
 * The middleware of a row opening its request. On the page already, in the
 * browser: the request joins the URL in place (a visit would list the table
 * again, newer rows pushing the opened one out) and the host is told.
 * Anywhere else (another page, a server render of a link carrying the key):
 * a visit to the page with the request open.
 */
export function openRequestMiddleware(to: RouteLike, from: RouteLike) {
  const redirect = openRequestRedirect(to, from)
  if (!redirect || typeof window === 'undefined') return redirect
  if (to.path !== window.location.pathname) return redirect
  const id = redirect.query[RECORD_KEY]
  writeRecord(id)
  const detail: OpenRequestDetail = { id }
  window.dispatchEvent(new CustomEvent(OPEN_REQUEST_EVENT, { detail }))
  return false
}

// --- the rows around the open request ---

export interface RowNavigation {
  index: number
  total: number
  hasPrev: boolean
  hasNext: boolean
  prev: () => void
  next: () => void
}

/**
 * What the page's `RequestDrawerHost` tells the panel, which the DMS renders
 * outside the page (`RequestDetail.vue`).
 */
export interface RequestPanelState {
  /** A host is on the page: it names the request, else the URL does. */
  hosted: boolean
  /** The request on screen. */
  id: string | null
  /** Its place among the rows of the table it was opened from. */
  navigation: RowNavigation | null
  /** The panel takes the focus once it shows the request: a row opened it. */
  focus: boolean
  /** Closes the panel the way the page wants: its URL follows. */
  close: (() => void) | null
}

/** The panel's state, one per app (and per server render). */
export function useRequestPanel() {
  return useDmsState<RequestPanelState>('dms-api:request-panel', () => ({
    hosted: false,
    id: null,
    navigation: null,
    focus: false,
    close: null,
  }))
}

/**
 * The open request's place among the rows of its table, and the steps to its
 * neighbours. A request the table does not show (a deep link, a filtered-out
 * row) has none.
 */
export function navigationAmong(
  ids: string[],
  id: string,
  step: (id: string) => void,
): RowNavigation | null {
  const index = ids.indexOf(id)
  if (index < 0) return null
  return {
    index,
    total: ids.length,
    hasPrev: index > 0,
    hasNext: index < ids.length - 1,
    prev: () => index > 0 && step(ids[index - 1]),
    next: () => index < ids.length - 1 && step(ids[index + 1]),
  }
}

/**
 * Indexes of the rows that start a day, given each row's day in table order:
 * the list is cut by day only when it runs through time (sorted on it), not
 * when another sort interleaves the days.
 */
export function dayStarts(days: string[]): number[] {
  const changes = days.flatMap((day, index) =>
    index > 0 && day !== days[index - 1] ? [index] : [],
  )
  const distinct = new Set(days).size
  return changes.length === distinct - 1 ? changes : []
}

// --- reading a request ---

/** A path as people read it: percent-escapes decoded, when they decode. */
export function decodePath(path: string): string {
  try {
    return decodeURI(path)
  } catch {
    return path
  }
}

/** The local calendar day of a moment, as `YYYY-MM-DD`. */
export function localDay(value: string | number | Date): string {
  const date = new Date(value)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

// Formats made once per locale and options: a table writes the time of
// each of its rows (2,000 after a few "Load more"), and making a format
// costs far more than using one (about 0.15 ms a row). The options are the
// constants below, so they key the cache as they are.
const dateFormats = new WeakMap<
  Intl.DateTimeFormatOptions,
  Map<string, Intl.DateTimeFormat>
>()
const relativeFormats = new Map<string, Intl.RelativeTimeFormat>()

function dateFormat(
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  let byLocale = dateFormats.get(options)
  if (!byLocale) {
    byLocale = new Map()
    dateFormats.set(options, byLocale)
  }
  const key = locale ?? ''
  let format = byLocale.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options)
    byLocale.set(key, format)
  }
  return format
}

function relativeFormat(locale: string | undefined): Intl.RelativeTimeFormat {
  const key = locale ?? ''
  let format = relativeFormats.get(key)
  if (!format) {
    format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    relativeFormats.set(key, format)
  }
  return format
}

const CLOCK_TIME: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
}

const CLOCK_TIME_MS: Intl.DateTimeFormatOptions = {
  ...CLOCK_TIME,
  fractionalSecondDigits: 3,
}

const SHORT_DAY: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }

const FULL_DATE_TIME: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hour12: false,
  timeZoneName: 'short',
}

function relativeDay(date: Date, now: Date, locale?: string): string | null {
  const days = Math.round(
    (new Date(now).setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) /
      86_400_000,
  )
  if (days !== 0 && days !== 1) return null
  const text = relativeFormat(locale).format(-days, 'day')
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1)
}

/**
 * The time of a request in a table: "17:02:28.412" today, "Yesterday,
 * 23:42:10.120" the day before, "Oct 8, 12:00:00.000" earlier.
 */
export function requestClock(
  value: string | number | Date,
  locale?: string,
  milliseconds = false,
  now: Date = new Date(),
): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const time = dateFormat(
    locale,
    milliseconds ? CLOCK_TIME_MS : CLOCK_TIME,
  ).format(date)
  if (localDay(date) === localDay(now)) return time
  const day =
    relativeDay(date, now, locale) ?? dateFormat(locale, SHORT_DAY).format(date)
  return `${day}, ${time}`
}

/** A moment in full, with its time zone: "Fri, Oct 10, 2026, 17:02:28.412 CEST". */
export function fullDateTime(
  value: string | number | Date,
  locale?: string,
): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return dateFormat(locale, FULL_DATE_TIME).format(date)
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1000],
]

/** How long ago a moment was, in words: "3 minutes ago", "il y a 2 jours". */
export function relativeTime(
  value: string | number | Date,
  locale?: string,
  now: number = Date.now(),
): string {
  const elapsed = new Date(value).getTime() - now
  if (Number.isNaN(elapsed)) return ''
  const [unit, size] =
    RELATIVE_UNITS.find(([, ms]) => Math.abs(elapsed) >= ms) ??
    RELATIVE_UNITS[RELATIVE_UNITS.length - 1]
  return relativeFormat(locale).format(Math.round(elapsed / size), unit)
}

/** How a request names itself in the panel: "POST /api/orders · 500". */
export function requestTitle(log: {
  method: string
  rawPath: string
  statusCode: number
}): string {
  return `${log.method.toUpperCase()} ${decodePath(log.rawPath)} · ${log.statusCode}`
}

/** The URL a request was sent to: `origin`, its path and its query. */
export function requestUrl(
  origin: string,
  rawPath: string,
  query: Record<string, string | string[]> | undefined,
): string {
  const search = new URLSearchParams()
  for (const [key, entry] of Object.entries(query ?? {})) {
    for (const item of Array.isArray(entry) ? entry : [entry])
      search.append(key, item)
  }
  const text = search.toString()
  return `${origin}${rawPath}${text ? `?${text}` : ''}`
}

export interface DurationScale {
  /** Where the duration ends on the bar, in % of its length. */
  share: number
  /** Where the slow threshold sits on the bar, in %. */
  threshold: number
  /** The duration over the threshold: 6.9 for six times and more. */
  ratio: number
  slow: boolean
  /** The value the bar ends at, in ms. */
  max: number
}

/**
 * A duration against the slow threshold, on a bar long enough for both: up
 * to twice the threshold, or to the duration when it is longer, so a request
 * seven times too slow does not look like one just over it.
 */
export function durationScale(
  durationMs: number,
  thresholdMs: number,
): DurationScale {
  const limit = Math.max(thresholdMs, 0)
  const max = Math.max(limit * 2, durationMs, 1)
  return {
    share: (Math.max(durationMs, 0) / max) * 100,
    threshold: (limit / max) * 100,
    ratio: limit > 0 ? durationMs / limit : 0,
    slow: limit > 0 && durationMs >= limit,
    max,
  }
}

/**
 * A duration over the slow threshold, to one decimal: "2.2", "0.4"; "< 0.1"
 * for a request far under it, which "0" would read as no time at all.
 */
export function thresholdRatio(ratio: number, locale?: string): string {
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  return ratio < 0.05 ? `< ${format.format(0.1)}` : format.format(ratio)
}

/** Why a body was not stored, as the API names it (`requestBodyOmitted`). */
export const BODY_OMISSIONS = [
  'disabled',
  'too-large',
  'not-json',
  'malformed',
  'empty',
  'not-read',
] as const
export type BodyOmission = (typeof BODY_OMISSIONS)[number]

export function bodyOmission(value: unknown): BodyOmission | null {
  return BODY_OMISSIONS.find((reason) => reason === value) ?? null
}

/**
 * The size a body had before it was cut: the size the capture recorded, else
 * the `content-length` it was sent with. Undefined for a body kept whole:
 * masking its secrets changed its length, not what it holds, and "249 B of
 * 260 B" would read as a cut. Undefined too when neither says more than what
 * was kept.
 */
export function originalBodySize(
  kept: number,
  truncated: boolean | undefined,
  recorded: number | null | undefined,
  headers: Record<string, string> | undefined,
): number | undefined {
  if (!truncated) return undefined
  const declared = Number(
    Object.entries(headers ?? {}).find(
      ([name]) => name.toLowerCase() === 'content-length',
    )?.[1],
  )
  const size =
    typeof recorded === 'number' && Number.isFinite(recorded)
      ? recorded
      : declared
  return Number.isFinite(size) && size > kept ? size : undefined
}

/** What the capture masked in a request, section by section (`redactions`). */
export interface Redactions {
  query: number
  requestBody: number
  responseBody: number
  /** Allow-listed headers left out: their name looks like a secret. */
  headers: string[]
}

const REDACTED = '[REDACTED]'

function maskedIn(text: string | undefined): number {
  return text ? text.split(REDACTED).length - 1 : 0
}

/**
 * What was masked, as the capture recorded it; for a log captured before it
 * did, the `[REDACTED]` values its bodies and query hold.
 */
export function redactionsOf(log: {
  redactions?: Partial<Redactions> | null
  query?: Record<string, string | string[]>
  requestBody?: string
  responseBody?: string
}): Redactions {
  if (log.redactions)
    return {
      query: log.redactions.query ?? 0,
      requestBody: log.redactions.requestBody ?? 0,
      responseBody: log.redactions.responseBody ?? 0,
      headers: log.redactions.headers ?? [],
    }
  return {
    query: Object.values(log.query ?? {})
      .flat()
      .filter((value) => value === REDACTED).length,
    requestBody: maskedIn(log.requestBody),
    responseBody: maskedIn(log.responseBody),
    headers: [],
  }
}

/** Whether a URL could name a captured request: a link may hold anything. */
export function isRequestId(id: string): boolean {
  return /^[\w.:-]{1,128}$/.test(id)
}

/** `href` with `key` set to `value`, kept relative when it was. */
export function withParam(href: string, key: string, value: string): string {
  const url = new URL(href, 'http://console.local')
  url.searchParams.set(key, value)
  return `${url.pathname}?${url.searchParams}`
}

/** The request logs page. */
const LOGS_PAGE = '/modules/api/logs'

/** How the route of a request behaves, read with it (`routeLatency`). */
export interface RouteLatency {
  /** The days it is read over, up to now; the tester's calls left out. */
  windowDays: number
  /** Median of the route's measured durations, in ms. */
  p50: number
  /** 95th percentile of the route's measured durations, in ms. */
  p95: number
  /** The route's requests at or over the slow threshold. */
  slow: number
}

/** A list of requests related to the one open, in the request logs. */
export interface RequestPivot {
  kind: 'same_route' | 'same_path' | 'slow_route'
  to: string
}

/**
 * The lists a request leads to, each holding requests. A request no route
 * matched leads to its path: the route list would be empty, unmatched
 * requests have no route. Its slow requests are offered once the route has
 * some, or, without its figures, when the request itself is one.
 */
export function requestPivots(log: {
  rawPath: string
  routeRegistered: boolean
  responseTimeMs: number | null
  slowThresholdMs: number
  routeLatency?: RouteLatency | null
  links: { sameRoute: string; samePath?: string | null }
}): RequestPivot[] {
  if (!log.routeRegistered)
    return [
      {
        kind: 'same_path',
        to: log.links.samePath ?? withParam(LOGS_PAGE, 'path', log.rawPath),
      },
    ]
  const pivots: RequestPivot[] = [
    { kind: 'same_route', to: log.links.sameRoute },
  ]
  if (log.links.samePath)
    pivots.push({ kind: 'same_path', to: log.links.samePath })
  const hasSlow = log.routeLatency
    ? log.routeLatency.slow > 0
    : log.responseTimeMs !== null &&
      durationScale(log.responseTimeMs, log.slowThresholdMs).slow
  if (hasSlow)
    pivots.push({
      kind: 'slow_route',
      to: withParam(log.links.sameRoute, 'slow', 'true'),
    })
  return pivots
}
