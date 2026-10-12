// Reading a captured request, for the request tables' cells and the side
// panel a row opens (`RequestDetail`): its URL, its time, its duration
// against the slow threshold, its bodies and the lists it leads to.

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
