/**
 * The three HTTP status classes the whole console reports on.
 *
 * One table, because they were being enumerated separately by the status
 * donut, the by-day breakdown bars, the "Requests by status" chart and the log
 * filters — four lists that had to agree on an order, a colour and a label,
 * and had already drifted into two different colour systems for the same data.
 *
 * Colours are hex rather than theme tokens: ApexCharts takes colours as
 * strings and cannot read a Tailwind class, and the hand-built bars have to
 * match the charts exactly.
 */
export interface StatusClass {
  /** Key on the backend's HistoryPoint / StatusBreakdown payloads. */
  key: 'success' | 'clientErrors' | 'serverErrors'
  /** `category` the backend's chart endpoints tag their points with. */
  category: string
  /** Palette pinned to the DMS reference. */
  color: string
  i18nKey: string
}

export const STATUS_CLASSES: readonly StatusClass[] = [
  {
    key: 'success',
    category: 'Success',
    color: '#10b981',
    i18nKey: 'page.api.summary.breakdown.success',
  },
  {
    key: 'clientErrors',
    category: 'Client Error',
    color: '#f59e0b',
    i18nKey: 'page.api.summary.breakdown.client',
  },
  {
    key: 'serverErrors',
    category: 'Server Error',
    color: '#ef4444',
    i18nKey: 'page.api.summary.breakdown.server',
  },
] as const

/** Colours in the table's order, for a chart's `color` prop. */
export const STATUS_CLASS_COLORS = STATUS_CLASSES.map((s) => s.color)

/** `category` → colour, for series the backend tags rather than orders. */
export const STATUS_CLASS_COLOR_BY_CATEGORY: Record<string, string> =
  Object.fromEntries(STATUS_CLASSES.map((s) => [s.category, s.color]))
