/** What the tester remembers of one call, to restore it from the history. */
export interface HistoryEntry {
  at: number
  path: string
  headers: Record<string, string>
  query: Record<string, string>
  pathValues: Record<string, string>
  body?: string
  useSession: boolean
  result: {
    status: number
    durationMs: number
    headers: Record<string, string>
    body: string
    error?: 'network' | 'request'
    message?: string
    sentWithSession: boolean
  }
}

/** Calls kept per route. */
export const HISTORY_MAX = 25

/** A stored response is cut here: the history is a reminder, not an archive. */
const STORED_BODY_MAX = 4096

const STORAGE_PREFIX = 'dmsApi.tester.history.'

/** Headers a credential travels in: typed in the tester, never stored. */
const SECRET_HEADERS = new Set(['authorization', 'cookie', 'x-api-key'])

function storageKey(route: string): string {
  return `${STORAGE_PREFIX}${route}`
}

/** The calls made to `route` from this browser, newest first. */
export function loadHistory(route: string): HistoryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(storageKey(route))
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed)
      ? (parsed as HistoryEntry[]).filter(
          (entry) => entry && typeof entry.at === 'number' && entry.result,
        )
      : []
  } catch {
    return []
  }
}

/**
 * Store the calls made to `route`. A response body is cut short and the
 * session token is never part of an entry: `useSession` only says it was on.
 */
export function saveHistory(route: string, entries: HistoryEntry[]): void {
  if (typeof window === 'undefined') return
  const trimmed = entries.slice(0, HISTORY_MAX).map((entry) => ({
    ...entry,
    headers: Object.fromEntries(
      Object.entries(entry.headers).filter(
        ([name]) => !SECRET_HEADERS.has(name.toLowerCase()),
      ),
    ),
    result: {
      ...entry.result,
      body: entry.result.body.slice(0, STORED_BODY_MAX),
    },
  }))
  try {
    if (trimmed.length === 0) window.localStorage.removeItem(storageKey(route))
    else window.localStorage.setItem(storageKey(route), JSON.stringify(trimmed))
  } catch {
    // Storage full or disabled: the history is a convenience, never a blocker.
  }
}
