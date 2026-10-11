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

import { normalizeRouteRef, parseRouteRef } from './http'

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

/** `METHOD /path` as the module names it: canonical path, method upper case. */
export function routeLabel(route: string): string {
  return normalizeRouteRef(route)
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

/** Where the request logs live, and the key their table's tab is under. */
const LOGS_PATH = '/modules/api/logs'
const TAB_QUERY_KEY = 'requests.tab'
const ALL_TAB = 'all'

interface RouteLike {
  path: string
  query: Query
}

/**
 * A move within the request logs. The first navigation of a visit may come
 * "from" the same location: it is an arrival.
 */
function movesInside(to: RouteLike, from: RouteLike | undefined): boolean {
  return (
    from?.path === LOGS_PATH &&
    JSON.stringify(from.query) !== JSON.stringify(to.query)
  )
}

/** The filters a link sets, which the filters bar only ever removes. */
const LINKED_KEYS = [...LINK_FILTER_KEYS, 'since', 'until'] as const

/**
 * Whether `to` brings a link's filter `from` does not hold: a "See also" of
 * the request panel, say. Removing a chip, choosing a period or opening a
 * request brings none.
 */
function bringsLink(to: RouteLike, from: RouteLike): boolean {
  const next = readLogsFilters(to.query)
  const previous = readLogsFilters(from.query)
  return LINKED_KEYS.some((key) => !!next[key] && next[key] !== previous[key])
}

/** Where a link to the request logs lands, and how. */
export interface LogsArrival {
  to: RouteLike
  /**
   * The table is mounted already, and reads its tab from the URL only when
   * it mounts (`TableView.vue`, `urlTab`): a visit keeping the page would
   * leave the tab kept from the last visit, whatever the URL says.
   */
  reload: boolean
}

/**
 * A link to the request logs with a filter but no tab would open the table
 * on the tab kept from the last visit (the 5xx, say) and hide most of what
 * the link names: it lands on the "All" tab instead. The console's links
 * name the tab themselves (`logsLink`, backend), so the table mounts on it;
 * this covers the URLs that do not. Where the table is mounted already (a
 * link followed by a visit within the page, or a page that mounted before
 * this ran), the landing loads the page anew. Undefined when nothing is to
 * change.
 */
export function logsArrival(
  to: RouteLike,
  from: RouteLike | undefined,
): LogsArrival | undefined {
  if (to.path !== LOGS_PATH) return undefined
  if (!hasLinkFilters(readLogsFilters(to.query))) return undefined
  const tab = single(to.query[TAB_QUERY_KEY])
  const target =
    tab === undefined
      ? { path: to.path, query: { ...to.query, [TAB_QUERY_KEY]: ALL_TAB } }
      : to
  if (from && movesInside(to, from))
    return bringsLink(to, from) ? { to: target, reload: true } : undefined
  if (tab !== undefined) return undefined
  return { to: target, reload: from?.path === LOGS_PATH }
}

function href(location: RouteLike): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(location.query)) {
    const text = single(value)
    if (text !== undefined) query.set(key, text)
  }
  return `${location.path}?${query}`
}

/**
 * A DMS middleware (`dms.frontend.ts`) landing the links to the request logs
 * (`logsArrival`): a redirect, or in the browser, over a mounted table, a
 * page load. The location already shown is replaced; a link followed is a
 * new entry, which Back leaves. Undefined lets the navigation go on.
 */
export function logsArrivalMiddleware(
  to: RouteLike,
  from: RouteLike | undefined,
): RouteLike | false | undefined {
  const arrival = logsArrival(to, from)
  if (!arrival?.reload || typeof window === 'undefined') return arrival?.to
  if (from && movesInside(to, from)) window.location.assign(href(arrival.to))
  else window.location.replace(href(arrival.to))
  return false
}

/** The tab the DMS table marks as shown, among its status tabs. */
const SHOWN_TAB_SELECTOR = '[aria-current="true"]'

/** The part of an element the table's tabs are read through. */
interface TabElement {
  textContent: string | null
  parentElement: { children: ArrayLike<unknown> } | null
}

/**
 * The status tab a request table's card shows: `all` (its first tab, under
 * a translated label) or the class (`5xx`). The DMS table shares it with
 * nothing it draws, the empty body included: it is read from its tabs.
 */
export function shownTab(card: {
  querySelector(selector: string): TabElement | null
}): string | undefined {
  const tab = card.querySelector(SHOWN_TAB_SELECTOR)
  const tabs = tab?.parentElement?.children
  if (!tab || !tabs) return undefined
  return tabs[0] === tab ? ALL_TAB : tab.textContent?.trim().slice(0, 3)
}
