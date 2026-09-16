import { isPeriodOffered, type PeriodOption } from './useStatsPeriods'

const STORAGE_KEY = 'dms-api:period'
const STATE_KEY = 'dms-api-selected-period'

/**
 * The period the user last picked, shared by the Overview, Routes and Logs
 * pages and kept across navigation and reloads.
 *
 * One preference for the whole module, not one per page: picking `30d` on the
 * Overview is a statement about what the user is looking at, and having each
 * page remember its own would make the console disagree with itself.
 *
 * `useState` carries it across in-app navigation, `localStorage` across
 * reloads. Reads and writes are guarded for SSR — there is no localStorage on
 * the server, and the state has to hydrate to whatever the server rendered.
 */
export function useSelectedPeriod() {
  const stored = useDmsState<string | null>(STATE_KEY, () => null)

  function read(): string | null {
    if (stored.value) return stored.value
    if (typeof window === 'undefined') return null
    try {
      const value = window.localStorage.getItem(STORAGE_KEY)
      stored.value = value
      return value
    } catch {
      // Private mode / disabled storage: the in-memory state still works for
      // the session, it just won't outlive the tab.
      return null
    }
  }

  function set(value: string): void {
    stored.value = value
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(STORAGE_KEY, value)
    } catch {
      /* see read() */
    }
  }

  function resolve(
    deepLink: string | undefined,
    options: PeriodOption[],
    fallback: string,
  ): string {
    return resolvePeriod(deepLink, options, read(), fallback)
  }

  return { resolve, set }
}

/**
 * The window a page should open on.
 *
 * 1. A `?period=` deep link wins — the Overview cards link into Logs with the
 *    window the row belongs to, and that intent outranks the preference. It
 *    deliberately does not overwrite what is stored: following one link should
 *    not repoint the whole console.
 * 2. Otherwise the stored preference, but only if this page offers it — a
 *    stored `1h` is valid on Logs and meaningless on Routes.
 * 3. Otherwise the page's own default, already clamped to its retention.
 *
 * A window the page cannot offer is *widened to the widest one it has*, not
 * dropped. The two retentions are configured separately, so a row seen at 90d
 * on the Overview can link into a Logs page that only keeps 30d — landing on
 * the 7-day default would show none of the traffic the row was about.
 */
export function resolvePeriod(
  deepLink: string | undefined,
  options: PeriodOption[],
  stored: string | null,
  fallback: string,
): string {
  for (const candidate of [deepLink, stored]) {
    if (isPeriodOffered(candidate, options)) return candidate as string
    const widened = widestOfferedBelow(candidate, options)
    if (widened) return widened
  }
  return fallback
}

/**
 * The widest window `options` offers that is no longer than `wanted`. Only
 * day windows compare — `1h` is either offered verbatim or has no equivalent.
 */
function widestOfferedBelow(
  wanted: string | undefined | null,
  options: PeriodOption[],
): string | null {
  const days = wanted?.match(/^(\d+)d$/)
  if (!days) return null
  const target = Number(days[1])
  let best: { value: string; days: number } | null = null
  for (const option of options) {
    const m = option.value.match(/^(\d+)d$/)
    if (!m) continue
    const n = Number(m[1])
    if (n <= target && (!best || n > best.days)) {
      best = { value: option.value, days: n }
    }
  }
  return best?.value ?? null
}
