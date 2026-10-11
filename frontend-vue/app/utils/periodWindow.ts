// The period of a console page lives in its URL (`?window=24h`), so a reload
// and a shared link show the same period. The DMS `PeriodSelector` keeps its
// period in memory only; `PeriodWindow` drives the cards' period scope from
// the URL instead. The last period chosen is kept for the tab
// (`sessionStorage`), one for the module: a page opened without `?window=`
// (the sidebar) takes it back.

/** The periods every console page offers, as the URL names them. */
export const PERIOD_WINDOWS = ['1h', '24h', '7d', '30d'] as const
export type PeriodWindow = (typeof PERIOD_WINDOWS)[number]

/** The query key the period is written under. */
export const WINDOW_QUERY_KEY = 'window'

/** The DMS period preset a window resolves to, for the cards' period scope. */
export const WINDOW_PRESETS = {
  '1h': 'last-hour',
  '24h': 'last-24h',
  '7d': 'last-7-days',
  '30d': 'last-30-days',
} as const satisfies Record<PeriodWindow, string>

const MS_PER_HOUR = 3_600_000
const MS_PER_DAY = 86_400_000

const WINDOW_SPAN_MS: Record<PeriodWindow, number> = {
  '1h': MS_PER_HOUR,
  '24h': MS_PER_DAY,
  '7d': 7 * MS_PER_DAY,
  '30d': 30 * MS_PER_DAY,
}

export function isPeriodWindow(value: unknown): value is PeriodWindow {
  return PERIOD_WINDOWS.includes(value as PeriodWindow)
}

type Query = Record<string, unknown>

/** The period a page's query names, if it names a known one. */
export function readWindow(query: Query): PeriodWindow | undefined {
  const raw = query[WINDOW_QUERY_KEY]
  const value = Array.isArray(raw) ? raw[0] : raw
  return isPeriodWindow(value) ? value : undefined
}

/** The same query with the period set, every other parameter kept. */
export function queryWithWindow<T extends Query>(
  query: T,
  window: PeriodWindow,
): T & { [WINDOW_QUERY_KEY]: PeriodWindow } {
  return { ...query, [WINDOW_QUERY_KEY]: window }
}

/** Where a rolling window starts, `now` being its end. */
export function windowStart(window: PeriodWindow, now: number): Date {
  return new Date(now - WINDOW_SPAN_MS[window])
}

/** Where the module's last period is kept, for the tab: one for its pages. */
export const WINDOW_STORAGE_KEY = 'dms-api:window'

/** What `sessionStorage` offers here: storage may be refused (private mode). */
export interface WindowStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/** The module's last period, if one was kept and is still offered. */
export function readStoredWindow(
  storage: WindowStorage | undefined,
): PeriodWindow | undefined {
  try {
    const value = storage?.getItem(WINDOW_STORAGE_KEY)
    return isPeriodWindow(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** Keeps a period for the module's other pages; anything else is ignored. */
export function storeWindow(
  storage: WindowStorage | undefined,
  window: unknown,
): void {
  if (!isPeriodWindow(window)) return
  try {
    storage?.setItem(WINDOW_STORAGE_KEY, window)
  } catch {
    // Storage refused: the period holds for this page only.
  }
}

/** The tab's `sessionStorage`, when the browser lends it. */
export function sessionWindowStorage(): WindowStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage
  } catch {
    return undefined
  }
}
