// The request logs page keeps its filters in its URL.
//
// `?window=`, `?method=`, `?slow=`, `?route=`, `?path=`, `?error=`,
// `?since=` and `?until=` are the request table's arrival filters
// (`queryParamFilters`, `src/pages/logs.ts`): the table reads them from the
// URL whatever wrote them (a link of another page, the period selector, the
// filters bar), counts its tabs with them, and follows them as they change.
// So the page has one filter state, which a reload, Back and a shared link
// all keep. `?from=` names the page a link came from, for the band that says
// so.

import { parseRouteRef } from './http'

type Query = Record<string, unknown>

/** Periods of the request logs, the presets every console page shares. */
export const LOG_WINDOWS = ['1h', '24h', '7d', '30d'] as const
export type LogWindow = (typeof LOG_WINDOWS)[number]

/**
 * The period when the URL names none and the session has none to restore:
 * the table's route applies the same (`LOGS_DEFAULT_WINDOW`, backend).
 */
export const DEFAULT_LOG_WINDOW: LogWindow = '24h'

/**
 * Every request kept, whatever its age: a choice of the page only, never the
 * default nor kept for the session (`?window=all`, which the route reads as
 * no period).
 */
export const ALL_LOG_WINDOW = 'all'

/** What the period selector of the request logs offers. */
export const LOG_PERIODS = [...LOG_WINDOWS, ALL_LOG_WINDOW] as const
export type LogPeriod = (typeof LOG_PERIODS)[number]

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
  window?: LogPeriod
  method?: string
  slow: boolean
  route?: string
  /** A path exactly as requested: one resource of a route. */
  path?: string
  error?: string
  /** An incident's range (ISO), from an Activity link: `[since, until)`. */
  since?: string
  until?: string
  from?: LinkOrigin
}

/** A change to the filters: `null` or `false` removes one. */
export interface LogsFiltersPatch {
  window?: LogPeriod | null
  method?: string | null
  slow?: boolean
  route?: null
  path?: null
  error?: null
  /** Removes the incident's range, `since` and `until` together. */
  incident?: null
}

function single(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' && first !== '' ? first : undefined
}

function isoTime(value: string | undefined): string | undefined {
  return value && !Number.isNaN(Date.parse(value)) ? value : undefined
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
    window: oneOf(LOG_PERIODS, single(query.window)),
    method: oneOf(LOG_METHODS, single(query.method)),
    // The table sends the value as it is, and the server reads "true" only.
    slow: single(query.slow) === 'true',
    route: single(query.route),
    path: single(query.path),
    error: single(query.error),
    since: isoTime(single(query.since)),
    until: isoTime(single(query.until)),
    from: oneOf(LINK_ORIGINS, single(query.from)),
  }
}

/** The filters with the period the table applies: the default when none. */
export function withDefaultWindow(filters: LogsFilters): LogsFilters {
  return { ...filters, window: filters.window ?? DEFAULT_LOG_WINDOW }
}

/** Whether the filters hold an incident's range. */
export function hasIncident(filters: LogsFilters): boolean {
  return !!filters.since || !!filters.until
}

/**
 * Whether a link's filters narrow the table: a route, a path, an error, an
 * incident's range.
 */
export function hasLinkFilters(filters: LogsFilters): boolean {
  return LINK_FILTER_KEYS.some((key) => !!filters[key]) || hasIncident(filters)
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
 * open request). Changing the period drops an incident's range, which the
 * period would no longer frame. Changing the period, or removing the last
 * linked filter, forgets the page the link came from: the band would name an
 * origin the filters no longer come from.
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
  if ('window' in patch) set('window', patch.window)
  if ('method' in patch) set('method', patch.method)
  if ('slow' in patch) set('slow', patch.slow ? 'true' : null)
  if ('route' in patch) set('route', null)
  if ('path' in patch) set('path', null)
  if ('error' in patch) set('error', null)
  if ('incident' in patch || 'window' in patch) {
    set('since', null)
    set('until', null)
  }
  const linked = hasLinkFilters(readLogsFilters(next))
  if ('window' in patch || !linked) delete next.from
  return next
}

/** The filters' part of the URL, cleared: the period, method, slowness and links. */
export function clearedLogsFilters(query: Query): Record<string, string> {
  return withLogsFilters(query, {
    window: null,
    method: null,
    slow: false,
    route: null,
    path: null,
    error: null,
    incident: null,
  })
}

/**
 * Whether the URL narrows the request table. "All" is no filter: it lists
 * every request kept.
 */
export function hasLogsFilters(filters: LogsFilters): boolean {
  return (
    (!!filters.window && filters.window !== ALL_LOG_WINDOW) ||
    !!filters.method ||
    filters.slow ||
    hasLinkFilters(filters)
  )
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
): LogsEmptyCause {
  if (state === 'error') return 'error'
  if (search?.trim()) return 'search'
  if (hasLinkFilters(filters)) return 'link'
  if (hasLogsFilters(filters)) return 'filters'
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
