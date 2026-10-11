import { describe, expect, it } from 'vitest'
import {
  durationParts,
  formatDecimal,
  formatClock,
  formatFullDateTime,
  formatLocale,
  formatMs,
  formatPercent,
  formatRelativeDay,
  formatThreshold,
  spanPart,
} from '../app/utils/format'

// Intl writes French spaces as narrow no-break ones: compare on plain spaces.
const plain = (text: string) => text.replace(/[  ]/g, ' ')

describe('formatPercent', () => {
  it('writes a percentage the way the locale does', () => {
    expect(formatPercent(11.44, 'en-GB')).toBe('11.4%')
    expect(plain(formatPercent(11.44, 'fr-FR'))).toBe('11,4 %')
  })

  it('keeps two decimals under 1 %, so a small rate does not read as zero', () => {
    expect(formatPercent(0.04, 'en-GB')).toBe('0.04%')
    expect(formatPercent(0, 'en-GB')).toBe('0%')
  })
})

describe('spanPart', () => {
  const MINUTE = 60_000

  it('names a window in one unit, hours up to two days', () => {
    expect(spanPart(15 * MINUTE)).toEqual({ amount: 15, unit: 'min' })
    expect(spanPart(24 * 60 * MINUTE)).toEqual({ amount: 24, unit: 'h' })
    expect(spanPart(7 * 24 * 60 * MINUTE)).toEqual({ amount: 7, unit: 'd' })
  })
})

describe('formatDecimal', () => {
  it('keeps one decimal under 10, none above', () => {
    expect(formatDecimal(4.25, 'en-GB')).toBe('4.3')
    expect(formatDecimal(1250.4, 'en-GB')).toBe('1,250')
  })
})

describe('formatRelativeDay', () => {
  const now = new Date(2026, 9, 10, 18, 0)

  it('gives the time alone today', () => {
    expect(formatRelativeDay(new Date(2026, 9, 10, 17, 33), 'en-GB', now)).toBe(
      '17:33',
    )
  })

  it('names yesterday in the interface language', () => {
    const date = new Date(2026, 9, 9, 17, 33)
    expect(formatRelativeDay(date, 'en-GB', now)).toBe('yesterday 17:33')
    expect(formatRelativeDay(date, 'fr-FR', now)).toBe('hier 17:33')
  })

  it('names the weekday within the week', () => {
    // 10 October 2026 is a Saturday.
    expect(formatRelativeDay(new Date(2026, 9, 5, 9, 5), 'en-GB', now)).toBe(
      'Mon 09:05',
    )
  })

  it('gives the date before, with the year when it is not this one', () => {
    expect(formatRelativeDay(new Date(2026, 8, 28, 9, 5), 'en-GB', now)).toBe(
      '28 Sept, 09:05',
    )
    expect(formatRelativeDay(new Date(2025, 8, 28, 9, 5), 'en-GB', now)).toBe(
      '28 Sept 2025, 09:05',
    )
  })

  it('is empty without a date', () => {
    expect(formatRelativeDay(null, 'en-GB', now)).toBe('')
    expect(formatRelativeDay('not a date', 'en-GB', now)).toBe('')
  })
})

describe('formatFullDateTime', () => {
  it('writes the whole date, for a tooltip', () => {
    const text = formatFullDateTime(new Date(2026, 9, 9, 17, 33), 'en-GB')
    expect(text).toContain('9 October 2026')
    expect(text).toContain('17:33')
  })
})

describe('durationParts', () => {
  const MINUTE = 60_000
  const HOUR = 60 * MINUTE

  it('keeps the two largest units, rounded down', () => {
    expect(durationParts(45_400)).toEqual([{ amount: 45, unit: 's' }])
    expect(durationParts(38 * MINUTE + 59_000)).toEqual([
      { amount: 38, unit: 'min' },
    ])
    expect(durationParts(2 * HOUR + 5 * MINUTE)).toEqual([
      { amount: 2, unit: 'h' },
      { amount: 5, unit: 'min' },
    ])
    expect(durationParts(3 * 24 * HOUR + 4 * HOUR + 10 * MINUTE)).toEqual([
      { amount: 3, unit: 'd' },
      { amount: 4, unit: 'h' },
    ])
  })

  it('drops a second unit at zero', () => {
    expect(durationParts(2 * HOUR)).toEqual([{ amount: 2, unit: 'h' }])
    expect(durationParts(24 * HOUR)).toEqual([{ amount: 1, unit: 'd' }])
  })

  it('never goes below zero', () => {
    expect(durationParts(-5000)).toEqual([{ amount: 0, unit: 's' }])
  })
})

describe('formatMs', () => {
  it('writes ms, seconds from 10 s, and "< 1 ms" under a millisecond', () => {
    expect(formatMs(0, 'en-GB')).toBe('0 ms')
    expect(formatMs(0.4, 'en-GB')).toBe('< 1 ms')
    expect(formatMs(1840, 'en-GB')).toBe('1,840 ms')
    expect(formatMs(12_400, 'en-GB')).toBe('12.4 s')
    expect(plain(formatMs(12_400, 'fr-FR'))).toBe('12,4 s')
  })
})

describe('formatThreshold', () => {
  it('writes a threshold in ms under a second, in seconds from one', () => {
    expect(formatThreshold(800, 'en-GB')).toBe('800 ms')
    expect(formatThreshold(1000, 'en-GB')).toBe('1 s')
    expect(formatThreshold(1500, 'en-GB')).toBe('1.5 s')
    expect(formatThreshold(2000, 'en-GB')).toBe('2 s')
    expect(plain(formatThreshold(1500, 'fr-FR'))).toBe('1,5 s')
  })
})

describe('one clock for the console', () => {
  it('reads a bare English as British English', () => {
    expect(formatLocale('en')).toBe('en-GB')
    expect(formatLocale('en-GB')).toBe('en-GB')
    expect(formatLocale('fr-FR')).toBe('fr-FR')
  })

  it('writes every time on 24 hours', () => {
    const evening = new Date(2026, 9, 10, 20, 45, 7)
    const locale = formatLocale('en')
    expect(formatFullDateTime(evening, locale)).toContain('20:45')
    expect(formatFullDateTime(evening, locale)).not.toMatch(/PM/i)
    expect(formatClock(evening, locale, false, evening)).toBe('20:45:07')
    expect(
      formatRelativeDay(new Date(2026, 9, 10, 0, 5), locale, evening),
    ).toBe('00:05')
  })
})
