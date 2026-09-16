import { describe, expect, it } from 'vitest'
import {
  buildPeriodOptions,
  defaultPeriodFor,
  isPeriodOffered,
  resolveMaxDays,
} from '../app/composables/useStatsPeriods'
import { resolvePeriod } from '../app/composables/useSelectedPeriod'

const values = (maxDays: number, kind: 'stats' | 'logs') =>
  buildPeriodOptions(maxDays, kind).map((o) => o.value)

const labels = (maxDays: number, kind: 'stats' | 'logs') =>
  buildPeriodOptions(maxDays, kind).map((o) => o.label)

describe('buildPeriodOptions', () => {
  it('ends on the retention, labelled as the widest window there is', () => {
    expect(values(30, 'stats')).toEqual(['1d', '7d', '30d'])
    expect(labels(30, 'stats')).toEqual(['24h', '7d', '30d (all)'])
  })

  it('offers every candidate below the retention', () => {
    expect(values(365, 'stats')).toEqual([
      '1d',
      '7d',
      '30d',
      '90d',
      '180d',
      '365d',
    ])
    expect(labels(365, 'stats').at(-1)).toBe('1y (all)')
  })

  it('drops windows the retention cannot answer for', () => {
    expect(values(3, 'stats')).toEqual(['1d', '3d'])
    // A retention below the shortest candidate leaves the retention alone.
    expect(values(1, 'stats')).toEqual(['1d'])
    expect(labels(1, 'stats')).toEqual(['24h (all)'])
  })

  it('prepends the sub-day window on logs only', () => {
    expect(values(30, 'logs')).toEqual(['1h', '1d', '7d', '30d'])
    expect(values(30, 'stats')).not.toContain('1h')
  })

  it('never offers a separate "all time" entry — the retention is it', () => {
    // Rows past the retention are pruned, so the widest window and
    // "everything" are the same data.
    expect(values(90, 'logs')).toEqual(['1h', '1d', '7d', '30d', '90d'])
  })
})

describe('resolveMaxDays', () => {
  const both = { statisticsLifetimeDays: 90, requestLogRetentionDays: 7 }

  it('bounds each page by its own store', () => {
    expect(resolveMaxDays(both, 'stats')).toBe(90)
    expect(resolveMaxDays(both, 'logs')).toBe(7)
  })

  it('falls back to the statistics retention when the log one is absent', () => {
    expect(resolveMaxDays({ statisticsLifetimeDays: 90 }, 'logs')).toBe(90)
  })

  it('falls back to the shipped default on a missing or unusable payload', () => {
    expect(resolveMaxDays(null, 'stats')).toBe(30)
    expect(resolveMaxDays(undefined, 'logs')).toBe(30)
    expect(
      resolveMaxDays({ statisticsLifetimeDays: Number.NaN }, 'stats'),
    ).toBe(30)
    expect(resolveMaxDays({ statisticsLifetimeDays: 0 }, 'stats')).toBe(30)
    expect(
      resolveMaxDays(
        { statisticsLifetimeDays: Number.POSITIVE_INFINITY },
        'stats',
      ),
    ).toBe(30)
  })
})

describe('defaultPeriodFor', () => {
  it('starts on a week, or the whole retention when that is shorter', () => {
    expect(defaultPeriodFor(365)).toBe('7d')
    expect(defaultPeriodFor(30)).toBe('7d')
    expect(defaultPeriodFor(3)).toBe('3d')
    expect(defaultPeriodFor(1)).toBe('1d')
  })
})

describe('isPeriodOffered', () => {
  const options = buildPeriodOptions(30, 'stats')

  it('accepts only values the page actually lists', () => {
    expect(isPeriodOffered('7d', options)).toBe(true)
    expect(isPeriodOffered('1h', options)).toBe(false)
    expect(isPeriodOffered('999d', options)).toBe(false)
    expect(isPeriodOffered(undefined, options)).toBe(false)
    expect(isPeriodOffered(null, options)).toBe(false)
    expect(isPeriodOffered('', options)).toBe(false)
  })
})

describe('resolvePeriod', () => {
  const stats = buildPeriodOptions(30, 'stats')
  const logs = buildPeriodOptions(30, 'logs')

  it('lets a deep link win over the stored preference', () => {
    expect(resolvePeriod('1d', stats, '30d', '7d')).toBe('1d')
  })

  it('ignores a deep link this page cannot offer', () => {
    // '1h' is a Logs window; arriving with it on a stats page falls through.
    expect(resolvePeriod('1h', stats, '30d', '7d')).toBe('30d')
  })

  it('uses the stored preference when no deep link is given', () => {
    expect(resolvePeriod(undefined, stats, '30d', '7d')).toBe('30d')
    expect(resolvePeriod(undefined, logs, '1h', '7d')).toBe('1h')
  })

  it('drops a stored sub-day value a stats page has no equivalent for', () => {
    expect(resolvePeriod(undefined, stats, '1h', '7d')).toBe('7d')
  })

  it('widens a window past this page to the widest it does offer', () => {
    // The two retentions are configured separately, so a 90d window from the
    // Overview can land on a Logs page that only keeps 30d. Showing 30 days is
    // the closest honest answer; falling back to the 7d default would hide the
    // traffic the link was about.
    expect(
      resolvePeriod('90d', buildPeriodOptions(30, 'logs'), null, '7d'),
    ).toBe('30d')
    expect(
      resolvePeriod(undefined, buildPeriodOptions(3, 'stats'), '30d', '3d'),
    ).toBe('3d')
  })

  it('falls back to the page default when nothing else applies', () => {
    expect(resolvePeriod(undefined, stats, null, '7d')).toBe('7d')
    // Nothing to widen to: every offered window is longer than the request.
    expect(
      resolvePeriod('1d', [{ value: '7d', label: '7d' }], null, '7d'),
    ).toBe('7d')
  })
})
