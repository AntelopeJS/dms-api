// How a request table opens a request in the DMS side panel on the right.
//
// The panel is the DMS's own (`registerSidePanel`, `useSidePanel`): docked
// next to the page from `lg`, which shrinks to make room and stays usable, a
// sheet over it below. No row action target opens a side panel yet, so a
// row's action is a page target, `?record=<id>` on the page it is on
// (`src/pages/request-table.ts`), which the module's middleware below takes:
// on the page already, the request joins the URL in place, without a visit
// (a visit would list the table again, newer rows pushing the opened one
// out), and the panel opens on it. `?record=` is also the deep link: a link
// or a reload opens it.
//
// History: opening and closing rewrite the current entry in place
// (`writeRecord`), never add one. An entry pushed for the panel makes Back
// and Forward traverse between two entries of the same page, and Inertia
// answers every traverse by mounting the page anew. The trade-off: Back
// leaves the page, it does not close the panel.

type Query = Record<string, unknown>

interface RouteLike {
  path: string
  query: Query
}

/** Where the console's pages are. */
const MODULE_BASE = '/modules/api'

/** Query key of the request the page has open: the deep link. */
export const RECORD_KEY = 'record'

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

/** The request a query has open, if any. */
export function readRecord(query: Query): string | null {
  const raw = query[RECORD_KEY]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && value !== '' ? value : null
}

/** `href` with `id` as its open request, or with none. */
export function hrefWithRecord(href: string, id?: string | null): string {
  const url = new URL(href)
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
export function writeRecord(id?: string | null) {
  window.history.replaceState(
    window.history.state,
    '',
    hrefWithRecord(window.location.href, id),
  )
}

/** What the panel, which the DMS renders outside the page, is told. */
export interface RequestPanelState {
  /** The request a row of the page opened, and the page it is on. */
  id: string | null
  path: string | null
  /** The panel takes the focus once it shows the request: a row opened it. */
  focus: boolean
}

/** The panel's state, one per app (and per server render). */
export function useRequestPanel() {
  return useDmsState<RequestPanelState>('dms-api:request-panel', () => ({
    id: null,
    path: null,
    focus: false,
  }))
}

/**
 * Whether a visit only opens a request on the page already shown: the same
 * path, and `?record=` the one thing added or changed.
 */
export function opensRequestInPlace(to: RouteLike, from: RouteLike): boolean {
  if (to.path !== from.path || !readRecord(to.query)) return false
  return Object.entries(to.query).every(
    ([key, value]) => key === RECORD_KEY || from.query[key] === value,
  )
}

/**
 * The middleware of a row opening its request (a page target naming
 * `?record=`). The side panel opens on it; on the page already, in the
 * browser, the request joins the URL in place and the visit stops there.
 * Anywhere else (a server render, a link from another page), the visit goes
 * on: the page loads with the request open.
 */
export function openRequestMiddleware(to: RouteLike, from: RouteLike) {
  const id = readRecord(to.query)
  if (!id || !to.path.startsWith(`${MODULE_BASE}/`)) return undefined
  useSidePanel(REQUEST_PANEL_ID).open()
  if (typeof window === 'undefined' || !opensRequestInPlace(to, from))
    return undefined
  writeRecord(id)
  useRequestPanel().value = { id, path: to.path, focus: true }
  return false
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

/** Nothing masked: what the panel shows before a request is read. */
export const NO_REDACTIONS: Redactions = {
  query: 0,
  requestBody: 0,
  responseBody: 0,
  headers: [],
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
    return log.links.samePath
      ? [{ kind: 'same_path', to: log.links.samePath }]
      : []
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
