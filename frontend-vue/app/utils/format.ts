const MS_PER_SECOND = 1000
const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 86_400_000
const BYTES_PER_KB = 1024
const SECONDS_DISPLAY_FROM_MS = 10_000
const PERCENT = 100
const DECIMAL_DISPLAY_BELOW = 10
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const DAYS_PER_WEEK = 7

/**
 * The locale figures, dates and times are written in, from the interface
 * language: a bare `en` is British English, so the console reads in one
 * convention (24-hour clock, day before month) like its `en-GB` texts.
 */
export function formatLocale(locale: string): string {
  return locale.toLowerCase() === 'en' ? 'en-GB' : locale
}

/** The clock every time of the console is written on: 24 hours. */
const CLOCK: Intl.DateTimeFormatOptions = { hourCycle: 'h23' }

const numberFormats = new Map<string, Intl.NumberFormat>()

/**
 * The locale's number format, made once: a table draws a count and a
 * duration in each of its thousands of cells, and making a format costs
 * far more than using one.
 */
function numberFormat(
  locale?: string,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = `${locale ?? ''}|${options ? JSON.stringify(options) : ''}`
  let format = numberFormats.get(key)
  if (!format) {
    format = new Intl.NumberFormat(locale, options)
    numberFormats.set(key, format)
  }
  return format
}

/** A count, grouped the way the locale writes it. */
export function formatCount(value: number, locale?: string): string {
  return numberFormat(locale).format(Math.round(value))
}

/**
 * A duration in ms, as "48 ms", "1,840 ms" or "12.4 s"; "< 1 ms" under a
 * millisecond, which "0 ms" would read as no time at all.
 */
export function formatMs(value: number, locale?: string): string {
  if (value > 0 && value < 1) return `< ${formatCount(1, locale)} ms`
  if (value >= SECONDS_DISPLAY_FROM_MS) {
    return `${numberFormat(locale, { maximumFractionDigits: 1 }).format(value / MS_PER_SECOND)} s`
  }
  return `${formatCount(value, locale)} ms`
}

/**
 * A duration threshold (the slow threshold of the settings), the one way
 * every page writes it: "800 ms" under a second, "1 s", "1.5 s" from one.
 */
export function formatThreshold(ms: number, locale?: string): string {
  if (ms < MS_PER_SECOND) return `${formatCount(ms, locale)} ms`
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(ms / MS_PER_SECOND)} s`
}

/**
 * A share in percent (0–100), written the way the locale writes a percentage
 * ("11.4%" in English, "11,4 %" in French): one decimal, two under 1 % so a
 * small rate does not read as zero.
 */
export function formatPercent(value: number, locale?: string): string {
  const digits = value > 0 && value < 1 ? 2 : 1
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: digits,
  }).format(value / PERCENT)
}

/** A count that may have a decimal, such as a rate per minute: "4.2", "1,250". */
export function formatDecimal(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: Math.abs(value) < DECIMAL_DISPLAY_BELOW ? 1 : 0,
  }).format(value)
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
    ...CLOCK,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
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
    ...CLOCK,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Whole calendar days from `date` to `now`, in the local time zone. */
function daysBefore(date: Date, now: Date): number {
  const start = new Date(date).setHours(0, 0, 0, 0)
  const end = new Date(now).setHours(0, 0, 0, 0)
  return Math.round((end - start) / MS_PER_DAY)
}

/**
 * A moment named from today: "17:33" today, "yesterday 17:33", "Mon 17:33"
 * within the week, "Oct 3, 17:33" before, with the year when it is not this
 * one. A bare "Oct 9, 17:33" beside a time of today reads as if it came after.
 */
export function formatRelativeDay(
  value: string | number | Date | undefined | null,
  locale?: string,
  now: Date = new Date(),
): string {
  if (value === undefined || value === null) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const time = date.toLocaleTimeString(locale, {
    ...CLOCK,
    hour: '2-digit',
    minute: '2-digit',
  })
  const days = daysBefore(date, now)
  if (days === 0) return time
  if (days === 1) {
    const yesterday = new Intl.RelativeTimeFormat(locale, {
      numeric: 'auto',
    }).format(-1, 'day')
    return `${yesterday} ${time}`
  }
  if (days > 1 && days < DAYS_PER_WEEK) {
    return `${date.toLocaleDateString(locale, { weekday: 'short' })} ${time}`
  }
  const day = date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
  return `${day}, ${time}`
}

/** The whole date and time, for a tooltip: "Friday 9 October 2026 at 17:33". */
export function formatFullDateTime(
  value: string | number | Date | undefined | null,
  locale?: string,
): string {
  if (value === undefined || value === null) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(locale, {
    ...CLOCK,
    dateStyle: 'full',
    timeStyle: 'short',
  })
}

export type DurationUnit = 's' | 'min' | 'h' | 'd'

/**
 * A length of time in its two largest units, rounded down: "45 s",
 * "38 min", "2 h 5 min", "3 d 4 h". The caller words each part.
 */
export function durationParts(
  ms: number,
): Array<{ amount: number; unit: DurationUnit }> {
  const seconds = Math.max(0, Math.floor(ms / MS_PER_SECOND))
  if (seconds < SECONDS_PER_MINUTE) return [{ amount: seconds, unit: 's' }]
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)
  if (minutes < MINUTES_PER_HOUR) return [{ amount: minutes, unit: 'min' }]
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  const parts: Array<{ amount: number; unit: DurationUnit }> =
    hours < HOURS_PER_DAY
      ? [
          { amount: hours, unit: 'h' },
          { amount: minutes % MINUTES_PER_HOUR, unit: 'min' },
        ]
      : [
          { amount: Math.floor(hours / HOURS_PER_DAY), unit: 'd' },
          { amount: hours % HOURS_PER_DAY, unit: 'h' },
        ]
  return parts.filter((part, index) => index === 0 || part.amount > 0)
}

/**
 * The length of a window in one unit, the way a card names it: "15 min",
 * "24 h", "7 d". Hours up to two days, so the last day reads "24 h".
 */
export function spanPart(ms: number): { amount: number; unit: DurationUnit } {
  const minutes = Math.round(ms / MS_PER_MINUTE)
  if (minutes < MINUTES_PER_HOUR) return { amount: minutes, unit: 'min' }
  const hours = Math.round(minutes / MINUTES_PER_HOUR)
  if (hours <= 2 * HOURS_PER_DAY) return { amount: hours, unit: 'h' }
  return { amount: Math.round(hours / HOURS_PER_DAY), unit: 'd' }
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
