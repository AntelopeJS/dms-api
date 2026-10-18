// The live histogram above the request logs: one bar per stretch of the
// page's period (a minute over the last hour, 15 minutes over 24 hours, up
// to 6 hours over 30 days: the server picks it), stacked by status class, on
// a scale a single spike cannot flatten.

const MS_PER_MINUTE = 60_000
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR

/** One bar of the histogram, as `/api/monitoring/logs/live` sends it. */
export interface MinuteBucket {
  start: number
  /** Every answer below 400: 2xx and 3xx. */
  success: number
  clientErrors: number
  serverErrors: number
}

/** A minute as the histogram draws it. */
export interface MinuteBar extends MinuteBucket {
  total: number
  /** The minute still running: its count is partial. */
  current: boolean
  /** Taller than the scale: drawn cut, with a mark. */
  clipped: boolean
  /** Heights of the stacked segments, in % of the plot, bottom to top. */
  heights: { success: number; clientErrors: number; serverErrors: number }
}

/** A peak this many times the usual busy minute no longer sets the scale. */
const PEAK_FACTOR = 3
/** The scale then stops at this many times the usual busy minute. */
const CEILING_FACTOR = 2
/** The usual busy minute: this quantile of the minutes that saw traffic. */
const TYPICAL_QUANTILE = 0.9

/**
 * The count the top of the plot stands for: the busiest minute, unless it
 * is a spike far above the usual traffic, which would crush every other bar
 * to a pixel. The scale then stops at twice the usual busy minute and the
 * spike is drawn cut. Empty minutes do not count: a quiet hour with a few
 * calls keeps them readable.
 */
export function scaleCeiling(totals: number[]): number {
  const busy = totals.filter((total) => total > 0).sort((a, b) => a - b)
  if (busy.length === 0) return 0
  const peak = busy[busy.length - 1]
  const typical = busy[Math.floor((busy.length - 1) * TYPICAL_QUANTILE)]
  return peak > typical * PEAK_FACTOR
    ? Math.ceil(typical * CEILING_FACTOR)
    : peak
}

/**
 * The bars of `buckets`, each `bucketMs` long, on their scale. The bar
 * holding `refreshedAt` is the one still running (none over a past range:
 * leave `refreshedAt` out). An empty bar has no segment: nothing is drawn.
 */
export function minuteBars(
  buckets: MinuteBucket[],
  refreshedAt?: string | number,
  bucketMs: number = MS_PER_MINUTE,
): { bars: MinuteBar[]; ceiling: number; clipped: boolean } {
  const totals = buckets.map(
    (bucket) => bucket.success + bucket.clientErrors + bucket.serverErrors,
  )
  const ceiling = scaleCeiling(totals)
  const at = refreshedAt === undefined ? NaN : new Date(refreshedAt).getTime()
  const bars = buckets.map((bucket, index) => {
    const total = totals[index]
    const shown = Math.min(total, ceiling)
    // Each segment keeps its share of the bar when the bar is cut.
    const percent = (value: number) =>
      total === 0 ? 0 : ((value / total) * shown * 100) / ceiling
    return {
      ...bucket,
      total,
      current: bucket.start <= at && at < bucket.start + bucketMs,
      clipped: total > ceiling,
      heights: {
        success: percent(bucket.success),
        clientErrors: percent(bucket.clientErrors),
        serverErrors: percent(bucket.serverErrors),
      },
    }
  })
  return { bars, ceiling, clipped: bars.some((bar) => bar.clipped) }
}

/** The busiest minute, for the chart's text alternative. */
export function peakBar(bars: MinuteBar[]): MinuteBar | undefined {
  return bars.reduce<MinuteBar | undefined>(
    (peak, bar) =>
      bar.total > 0 && (!peak || bar.total > peak.total) ? bar : peak,
    undefined,
  )
}

/** The minutes of the time axis: the first, the middle and the last. */
export function axisTicks(bars: MinuteBar[]): number[] {
  if (bars.length === 0) return []
  const last = bars.length - 1
  return [...new Set([0, Math.floor(last / 2), last])]
}

/**
 * The length of a bar, as its title names it: "minute", "15 min", "6 h",
 * "day".
 */
export type BucketLabel =
  | { unit: 'minute' }
  | { unit: 'minutes' | 'hours'; amount: number }
  | { unit: 'day' }

export function bucketLabel(bucketMs: number): BucketLabel {
  if (bucketMs <= MS_PER_MINUTE) return { unit: 'minute' }
  if (bucketMs < MS_PER_HOUR)
    return { unit: 'minutes', amount: Math.round(bucketMs / MS_PER_MINUTE) }
  if (bucketMs < MS_PER_DAY)
    return { unit: 'hours', amount: Math.round(bucketMs / MS_PER_HOUR) }
  return { unit: 'day' }
}

/**
 * How the axis, the tooltip and the summary write a bar's time: the time
 * alone over a day at most, the date and time over longer periods, the date
 * alone for bars of a day.
 */
export type BarTimeFormat = 'time' | 'dateTime' | 'date'

export function barTimeFormat(bucketMs: number, spanMs: number): BarTimeFormat {
  if (bucketMs >= MS_PER_DAY) return 'date'
  return spanMs > MS_PER_DAY ? 'dateTime' : 'time'
}

/**
 * What the histogram's live indicator says: following the page's live mode,
 * paused with it, reconnecting since the last read failed (from the first
 * failure), or a past range, which nothing updates.
 */
export type LiveStatus = 'live' | 'paused' | 'reconnecting' | 'past'

export function liveStatus(
  live: boolean,
  failures: number,
  followsNow = true,
): LiveStatus {
  if (!followsNow) return failures > 0 ? 'reconnecting' : 'past'
  if (!live) return 'paused'
  return failures > 0 ? 'reconnecting' : 'live'
}
