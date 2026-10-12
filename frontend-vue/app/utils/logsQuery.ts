// The request logs page keeps its filters in its URL.
//
// `?method=`, `?slow=`, `?route=`, `?path=` and `?error=` are the request
// table's arrival filters (`queryParamFilters`, `src/pages/logs.ts`): the
// table reads them from the URL whatever wrote them (a link of another page,
// the filters bar), counts its tabs with them, and follows them as they
// change. So the page has one filter state, which a reload, Back and a
// shared link all keep. `?from=` names the page a link came from, for the
// band that says so.
//
// The period is the toolbar's DMS `PeriodSelector`'s, which the table
// follows through its period scope and the blocks read with
// `usePeriodScope` (`useApiPeriod`): its "All time" is every request kept,
// and an incident a link frames is a range of its own (`?api.from=` /
// `?api.to=`), a custom range the selector does not otherwise offer. A
// change to it is written in its URL keys, which the selector follows.

import { parseRouteRef } from './http'

type Query = Record<string, unknown>

/** What the filters read of the page's period, `null` until it is known. */
export type LogsPeriod = Pick<PeriodState, 'preset' | 'range'> | null

/** The selector's URL keys: `<selector id>.<key>` (`PERIOD_SCOPE`). */
const PERIOD_KEYS = {
  period: 'api.period',
  from: 'api.from',
  to: 'api.to',
} as const

/** The DMS "All time": every request kept, which the request logs offer. */
const ALL_TIME = 'all'

/** Methods the filters bar offers. */
export const LOG_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const

/** Filters only a link sets: the bar shows them as chips, each removable. */
export const LINK_FILTER_KEYS = ['route', 'path', 'error'] as const
export type LinkFilterKey = (typeof LINK_FILTER_KEYS)[number]

/** Pages a link to the request logs may name as its origin (`?from=`). */
export const LINK_ORIGINS = ['overview', 'routes'] as const
export type LinkOrigin = (typeof LINK_ORIGINS)[number]

/** The filters of the request logs, as the URL holds them. */
export interface LogsFilters {
  method?: string
  slow: boolean
  route?: string
  /** A path exactly as requested: one resource of a route. */
  path?: string
  error?: string
  from?: LinkOrigin
}

/** A change to the filters: `null` or `false` removes one. */
export interface LogsFiltersPatch {
  /** Every request kept: the period's "All time". */
  allTime?: true
  method?: string | null
  slow?: boolean
  route?: null
  path?: null
  error?: null
  /** Removes the incident's range: the period becomes "All time". */
  incident?: null
}

function single(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' && first !== '' ? first : undefined
}

function oneOf<T extends string>(
  values: readonly T[],
  value: string | undefined,
): T | undefined {
  return values.find((candidate) => candidate === value)
}

/** The filters a URL query holds; a value the table would not apply is left out. */
export function readLogsFilters(query: Query): LogsFilters {
  return {
    method: oneOf(LOG_METHODS, single(query.method)),
    // The table sends the value as it is, and the server reads "true" only.
    slow: single(query.slow) === 'true',
    route: single(query.route),
    path: single(query.path),
    error: single(query.error),
    from: oneOf(LINK_ORIGINS, single(query.from)),
  }
}

/** Whether the period is every request kept. */
export function isAllTime(period: LogsPeriod): boolean {
  return period?.preset === ALL_TIME
}

/**
 * The incident's range a link framed the period on: a custom range, which
 * the selector offers no other way.
 */
export function incidentRange(
  period: LogsPeriod,
): { from: Date; to: Date } | null {
  return period?.preset === 'custom' ? period.range : null
}

/** The preset the period follows, neither "All time" nor a range. */
export function windowPreset(period: LogsPeriod): string | undefined {
  return period && !isAllTime(period) && !incidentRange(period)
    ? period.preset
    : undefined
}

/**
 * The period a link to the request logs carries, for their selector to open
 * on: the preset the period follows, if any.
 */
export function linkedPeriod(period: LogsPeriod): Record<string, string> {
  const preset = windowPreset(period)
  return preset ? { [PERIOD_KEYS.period]: preset } : {}
}

/**
 * Whether a link's filters narrow the table: a route, a path, an error, an
 * incident's range.
 */
function hasLinkFilters(filters: LogsFilters, period: LogsPeriod): boolean {
  return (
    LINK_FILTER_KEYS.some((key) => !!filters[key]) || !!incidentRange(period)
  )
}

/** Whether a `?route=` can name a route at all (`garbage` cannot). */
export function isRouteRef(route: string): boolean {
  return parseRouteRef(route) !== null
}

/** The method a route reference fixes: `POST /webhooks` → `POST`. */
export function routeMethod(route: string | undefined): string | undefined {
  const method = route?.trim().split(/\s+/)[0]?.toUpperCase()
  return oneOf(LOG_METHODS, method)
}

/**
 * `query` with `patch` applied, every other key kept (the table's tab, the
 * open request, the period). "All time" replaces an incident's range, and
 * so does removing the range: the selector keeps a period its URL keys no
 * longer name, so the change names the one it takes. "All time", or
 * removing the last linked filter, forgets the page the link came from: the
 * band would name an origin the filters no longer come from.
 */
export function withLogsFilters(
  query: Query,
  patch: LogsFiltersPatch,
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(query)) {
    const text = single(value)
    if (text !== undefined) next[key] = text
  }
  const set = (key: string, value: string | null | undefined) => {
    if (value) next[key] = value
    else delete next[key]
  }
  const incident = 'incident' in patch && !!query[PERIOD_KEYS.from]
  if (patch.allTime || incident) {
    set(PERIOD_KEYS.period, ALL_TIME)
    set(PERIOD_KEYS.from, null)
    set(PERIOD_KEYS.to, null)
  }
  if ('method' in patch) set('method', patch.method)
  if ('slow' in patch) set('slow', patch.slow ? 'true' : null)
  if ('route' in patch) set('route', null)
  if ('path' in patch) set('path', null)
  if ('error' in patch) set('error', null)
  const linked =
    LINK_FILTER_KEYS.some((key) => !!next[key]) || !!next[PERIOD_KEYS.from]
  if (patch.allTime || !linked) delete next.from
  return next
}

/**
 * The filters' part of the URL, cleared: method, slowness and links. The
 * period stays the selector's, but for an incident's range.
 */
export function clearedLogsFilters(query: Query): Record<string, string> {
  return withLogsFilters(query, {
    method: null,
    slow: false,
    route: null,
    path: null,
    error: null,
    incident: null,
  })
}

/**
 * Whether the URL narrows the request table besides its period: a method,
 * the slow requests, a link's filters.
 */
export function hasLogsFilters(
  filters: LogsFilters,
  period: LogsPeriod,
): boolean {
  return !!filters.method || filters.slow || hasLinkFilters(filters, period)
}

/** Why the request table is empty, to word its empty state. */
export type LogsEmptyCause =
  | 'error'
  | 'search'
  | 'link'
  | 'filters'
  | 'first-run'

/**
 * What the empty table owes its emptiness to, the most specific first: a
 * failed list, the search, a link's filters, the other filters, else nothing
 * captured yet. The DMS only knows its own search and filters: the URL's
 * filters are read here.
 */
export function logsEmptyCause(
  state: string | undefined,
  search: string | undefined,
  filters: LogsFilters,
  period: LogsPeriod,
): LogsEmptyCause {
  if (state === 'error') return 'error'
  if (search?.trim()) return 'search'
  if (hasLinkFilters(filters, period)) return 'link'
  // A period frames the rows unless it is "All time".
  if (hasLogsFilters(filters, period) || !isAllTime(period)) return 'filters'
  return 'first-run'
}

const BYTES_PER_KB = 1024

/**
 * The body size limit in the unit that reads best: `none` when bodies are
 * not captured, bytes under 1 KB (a 300 B limit is not "0 KB").
 */
export function bodyLimit(bytes: number): {
  unit: 'none' | 'b' | 'kb'
  amount: number
} {
  if (bytes <= 0) return { unit: 'none', amount: 0 }
  if (bytes < BYTES_PER_KB) return { unit: 'b', amount: Math.round(bytes) }
  return { unit: 'kb', amount: Math.round((bytes / BYTES_PER_KB) * 10) / 10 }
}
