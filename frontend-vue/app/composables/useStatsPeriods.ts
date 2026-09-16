import { computed, ref } from 'vue'
import type { StatsRetention } from './useApiIntrospection'

export interface PeriodOption {
  value: string
  label: string
}

/**
 * Which store the windows are read from, and therefore which retention bounds
 * them: the Overview and Routes charts come from the day rollups, the Logs
 * page from the raw request logs. The two are pruned by separate settings.
 */
export type PeriodKind = 'stats' | 'logs'

// Windows offered by every period filter, shortest first. Only the ones
// strictly shorter than the retention are kept: the retention itself is
// appended as the "all" entry, so the list always ends on the oldest day the
// data can still answer for and never offers a window that would chart empty.
const CANDIDATE_DAYS = [1, 7, 30, 90, 180]

// Sub-day window, offered on Logs only — the day rollups behind the other two
// pages cannot resolve it. Kept as the primary debugging window.
const HOUR_OPTION: PeriodOption = { value: '1h', label: '1h' }

const PREFERRED_DEFAULT_DAYS = 7

const RETENTION_STATE_KEY = 'dms-api-retention'

// What the module ships with (STATISTICS_RETENTION_MS). Used until the real
// retention is known, and when it can't be read at all — an older backend has
// no retention endpoint — so the selector degrades to the options it had
// before rather than emptying out.
const FALLBACK_MAX_DAYS = 30

/**
 * Period options for a monitoring page, derived from the retention configured
 * on the Settings page. Raising it to a year makes a year's worth of windows
 * selectable; lowering it to a few days shrinks the list to match.
 *
 * Values are the backend-native `Nd` / `Nh` tokens both parsers already read
 * (`parsePeriod` in services/period.ts, `periodToMs` in routes/logs.ts), so the
 * same string can be stored, deep-linked and sent as a query parameter without
 * translation. Labels stay human.
 *
 * The retention is re-read on every `load()` rather than cached across the
 * session: it changes whenever someone saves the Settings page, and a stale
 * ceiling would silently cap the selector at the old value.
 */
export function useStatsPeriods(kind: PeriodKind = 'stats') {
  const { getRetention } = useApiIntrospection()
  const maxDays = ref(FALLBACK_MAX_DAYS)
  // One request per navigation, not one per page: the retention is a single
  // setting and every page asks for it on mount. Cleared on a full reload,
  // which is also when a Settings change takes effect for the whole console.
  const cached = useDmsState<StatsRetention | null>(RETENTION_STATE_KEY, () => null)

  const options = computed<PeriodOption[]>(() =>
    buildPeriodOptions(maxDays.value, kind),
  )

  /**
   * Read the retention, then report the window to start on: `7d` unless the
   * retention is shorter than a week, in which case the whole retention is the
   * widest thing there is to show.
   */
  async function load(): Promise<string> {
    if (!cached.value) {
      try {
        cached.value = await getRetention()
      } catch {
        // No retention endpoint (older backend) or a failed call: fall through
        // with the shipped default rather than leaving the page without a
        // window to fetch.
        cached.value = null
      }
    }
    maxDays.value = resolveMaxDays(cached.value, kind)
    return defaultPeriodFor(maxDays.value)
  }

  return { options, load }
}

/**
 * Ceiling for a page's option list, from a retention payload.
 *
 * The log retention is the right one for the Logs page, but a backend that
 * predates the field omits it — fall back to the statistics one rather than to
 * the shipped default, which is usually further off.
 */
export function resolveMaxDays(
  retention: StatsRetention | null | undefined,
  kind: PeriodKind,
): number {
  const raw =
    kind === 'logs'
      ? (retention?.requestLogRetentionDays ??
        retention?.statisticsLifetimeDays)
      : retention?.statisticsLifetimeDays
  const days = Math.round(raw as number)
  // Number.isFinite, not Math.max: `Math.max(1, NaN)` is NaN, so a payload
  // missing the field would poison every window built from it.
  return Number.isFinite(days) && days >= 1 ? days : FALLBACK_MAX_DAYS
}

/** Starting window: a week, or the whole retention when that is shorter. */
export function defaultPeriodFor(maxDays: number): string {
  return `${Math.min(PREFERRED_DEFAULT_DAYS, maxDays)}d`
}

export function buildPeriodOptions(
  maxDays: number,
  kind: PeriodKind,
): PeriodOption[] {
  const options = CANDIDATE_DAYS.filter((d) => d < maxDays).map((d) => ({
    value: `${d}d`,
    label: labelFor(d),
  }))
  options.push({ value: `${maxDays}d`, label: `${labelFor(maxDays)} (all)` })
  // Logs also reads raw rows, so it can go below a day. There is no separate
  // "all time" entry: rows past the retention are pruned, so the widest window
  // and "everything" are the same data.
  return kind === 'logs' ? [HOUR_OPTION, ...options] : options
}

function labelFor(days: number): string {
  if (days === 1) return '24h'
  if (days % 365 === 0) return `${days / 365}y`
  return `${days}d`
}

/** Whether a stored/deep-linked value is offered by a page's option list. */
export function isPeriodOffered(
  value: string | undefined | null,
  options: PeriodOption[],
): boolean {
  return !!value && options.some((o) => o.value === value)
}
