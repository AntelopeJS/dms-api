// The period of a console page is the DMS `PeriodSelector`'s, kept in the
// page URL under its id (`?api.period=last-24h`, `PERIOD_SCOPE` on the
// server). Links that carry the period on read it from there.

type Query = Record<string, unknown>

/** The presets every console page offers, by their DMS names. */
export const PERIOD_PRESETS = [
  'last-hour',
  'last-24h',
  'last-7-days',
  'last-30-days',
] as const
export type PeriodPresetName = (typeof PERIOD_PRESETS)[number]

/** The period when neither the URL nor the user names one. */
export const DEFAULT_PERIOD: PeriodPresetName = 'last-24h'

/** The URL key of the page's period: `<selector id>.period`. */
export const PERIOD_QUERY_KEY = 'api.period'

/** The preset a page's query names, if it is one the pages offer. */
export function readPeriod(query: Query): PeriodPresetName | undefined {
  const raw = query[PERIOD_QUERY_KEY]
  const value = Array.isArray(raw) ? raw[0] : raw
  return PERIOD_PRESETS.find((preset) => preset === value)
}
