const MS_PER_SECOND = 1000
const MS_PER_MINUTE = 60_000
const MS_PER_HOUR = 3_600_000
const MS_PER_DAY = 86_400_000
const BYTES_PER_KB = 1024
const SECONDS_DISPLAY_FROM_MS = 10_000

/** A count, grouped the way the locale writes it. */
export function formatCount(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale).format(Math.round(value))
}

/** A duration in ms, as "48 ms", "1,840 ms" or "12.4 s". */
export function formatMs(value: number, locale?: string): string {
  if (value >= SECONDS_DISPLAY_FROM_MS) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / MS_PER_SECOND)} s`
  }
  return `${formatCount(value, locale)} ms`
}

/** A share in percent (0–100), with one decimal. */
export function formatPercent(value: number, locale?: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} %`
}

export function formatBytes(bytes: number, locale?: string): string {
  if (bytes < BYTES_PER_KB) return `${formatCount(bytes, locale)} B`
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / BYTES_PER_KB)} KB`
}

function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString()
}

/**
 * The time of a request: "14:31:58.412" today, "Sep 28, 14:31:58" before.
 */
export function formatClock(
  value: string | number | Date | undefined,
  locale?: string,
  milliseconds = false,
  now: Date = new Date(),
): string {
  if (value === undefined || value === null) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const time = date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...(milliseconds ? { fractionalSecondDigits: 3 } : {}),
  })
  if (isSameDay(date, now)) return time
  const day = date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
  })
  return `${day}, ${time}`
}

/** A full date and time, for a title or a detail line. */
export function formatDateTime(
  value: string | number | Date | undefined,
  locale?: string,
): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** "12 s", "3 min", "2 h", "4 d": how long ago, short. */
export function formatAgo(
  value: string | number | Date | undefined,
  now: number = Date.now(),
): { amount: number; unit: 's' | 'min' | 'h' | 'd' } | null {
  if (!value) return null
  const elapsed = Math.max(0, now - new Date(value).getTime())
  if (elapsed < MS_PER_MINUTE) {
    return { amount: Math.round(elapsed / MS_PER_SECOND), unit: 's' }
  }
  if (elapsed < MS_PER_HOUR) {
    return { amount: Math.round(elapsed / MS_PER_MINUTE), unit: 'min' }
  }
  if (elapsed < MS_PER_DAY) {
    return { amount: Math.round(elapsed / MS_PER_HOUR), unit: 'h' }
  }
  return { amount: Math.round(elapsed / MS_PER_DAY), unit: 'd' }
}

/** Pretty JSON when the text parses, the text itself otherwise. */
export function prettyBody(text: string | undefined | null): {
  text: string
  json: boolean
} {
  if (!text) return { text: '', json: false }
  try {
    return { text: JSON.stringify(JSON.parse(text), null, 2), json: true }
  } catch {
    return { text, json: false }
  }
}

/** UTF-8 size of a text, in bytes. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}
