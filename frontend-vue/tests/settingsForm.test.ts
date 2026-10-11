import { describe, expect, it, vi } from 'vitest'
import {
  addHeaderNames,
  createRetentionGuard,
  invalidHeaderNames,
  isLinkedField,
  isLowered,
  normalizeHeaderName,
  numberAdjustment,
  parseTypedNumber,
  type RetentionChange,
  retentionChoices,
  retentionGuardOf,
} from '../app/utils/settingsForm'

describe('header names', () => {
  it('stores a typed name trimmed and in lower case', () => {
    expect(normalizeHeaderName('  X-Request-Id ')).toBe('x-request-id')
  })

  it('adds names once each, normalized, up to the cap', () => {
    expect(addHeaderNames(['accept'], ['X-Request-Id', 'ACCEPT', ' '])).toEqual(
      ['accept', 'x-request-id'],
    )
    expect(addHeaderNames(['a', 'b'], ['c', 'd'], 3)).toEqual(['a', 'b', 'c'])
  })

  it('flags the names HTTP does not allow', () => {
    expect(
      invalidHeaderNames(['x-ok', 'x(bad)', 'stripe-signature', 'a:b']),
    ).toEqual(['x(bad)', 'a:b'])
  })
})

describe('parseTypedNumber', () => {
  it('reads a number as typed in the field locale', () => {
    expect(parseTypedNumber('1020', 'en-GB')).toBe(1020)
    expect(parseTypedNumber('1,020', 'en-GB')).toBe(1020)
    expect(parseTypedNumber('1 020', 'fr-FR')).toBe(1020)
    expect(parseTypedNumber(' -100 ', 'en-GB')).toBe(-100)
  })

  it('tells an empty field from one that is not a number', () => {
    expect(parseTypedNumber('  ', 'en-GB')).toBeNull()
    expect(parseTypedNumber('abc', 'en-GB')).toBeNaN()
  })
})

describe('numberAdjustment', () => {
  const bounds = { min: 50, max: 600_000 }

  it('says why the field holds another value than the one typed', () => {
    expect(numberAdjustment(1020, 1000, bounds)).toBe('step')
    expect(numberAdjustment(999_999, 600_000, bounds)).toBe('max')
    expect(numberAdjustment(-100, 50, bounds)).toBe('min')
  })

  it('is nothing when the field holds what was typed, or nothing', () => {
    expect(numberAdjustment(2000, 2000, bounds)).toBeNull()
    expect(numberAdjustment(null, undefined, bounds)).toBeNull()
    expect(numberAdjustment(Number.NaN, undefined, bounds)).toBeNull()
  })
})

describe('isLinkedField', () => {
  it('matches the anchor of the field the page was opened on', () => {
    expect(isLinkedField('#requestLogMaxBodyKb', 'requestLogMaxBodyKb')).toBe(
      true,
    )
    expect(
      isLinkedField('#requestLogCaptureHeaders', 'requestLogMaxBodyKb'),
    ).toBe(false)
    expect(isLinkedField('', 'requestLogMaxBodyKb')).toBe(false)
    expect(isLinkedField('#%E0%A4%A', 'requestLogMaxBodyKb')).toBe(false)
  })
})

describe('retentionChoices', () => {
  it('offers the choices, and the value in force when it is none of them', () => {
    expect(retentionChoices([30, 60, 90], 90)).toEqual([30, 60, 90])
    expect(retentionChoices([30, 60, 90], 45)).toEqual([30, 45, 60, 90])
    expect(retentionChoices([30, 60, 90], null)).toEqual([30, 60, 90])
  })
})

describe('isLowered', () => {
  it('is a value below the saved one', () => {
    expect(isLowered(30, 90)).toBe(true)
    expect(isLowered(90, 90)).toBe(false)
    expect(isLowered(120, 90)).toBe(false)
    expect(isLowered(null, 90)).toBe(false)
    expect(isLowered(30, undefined)).toBe(false)
  })
})

describe('createRetentionGuard', () => {
  const change = (field: string, to: number): RetentionChange => ({
    field,
    label: field,
    from: 90,
    to,
    impact: { days: 60, requests: 1000 },
  })

  it('lets a save through when nothing is lowered', () => {
    const ask = vi.fn()
    const guard = createRetentionGuard(ask, vi.fn())
    expect(guard.allowSubmit()).toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })

  it('asks once for every lowered field, then submits again', async () => {
    const ask = vi.fn(async () => true)
    const resubmit = vi.fn()
    const guard = createRetentionGuard(ask, resubmit)
    guard.set('statisticsLifetimeDays', change('statisticsLifetimeDays', 30))
    guard.set('requestLogRetentionDays', change('requestLogRetentionDays', 7))

    expect(guard.allowSubmit()).toBe(false)
    // A second field's validator in the same pass does not ask again.
    expect(guard.allowSubmit()).toBe(false)
    await vi.waitFor(() => expect(resubmit).toHaveBeenCalledOnce())
    expect(ask).toHaveBeenCalledOnce()
    expect(ask.mock.calls[0]![0]).toHaveLength(2)

    expect(guard.allowSubmit()).toBe(true)
  })

  it('keeps the save stopped when the user cancels', async () => {
    const ask = vi.fn(async () => false)
    const resubmit = vi.fn()
    const guard = createRetentionGuard(ask, resubmit)
    guard.set('statisticsLifetimeDays', change('statisticsLifetimeDays', 30))

    expect(guard.allowSubmit()).toBe(false)
    await vi.waitFor(() => expect(ask).toHaveBeenCalledOnce())
    await Promise.resolve()
    expect(resubmit).not.toHaveBeenCalled()
    expect(guard.allowSubmit()).toBe(false)
    await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(2))
  })

  it('asks again once the lowered value changes', async () => {
    const ask = vi.fn(async () => true)
    const guard = createRetentionGuard(ask, vi.fn())
    guard.set('statisticsLifetimeDays', change('statisticsLifetimeDays', 60))
    guard.allowSubmit()
    await vi.waitFor(() => expect(guard.allowSubmit()).toBe(true))

    guard.set('statisticsLifetimeDays', change('statisticsLifetimeDays', 30))
    expect(guard.allowSubmit()).toBe(false)
    guard.set('statisticsLifetimeDays', null)
    expect(guard.allowSubmit()).toBe(true)
  })
})

describe('retentionGuardOf', () => {
  it('shares one guard per form', () => {
    const form = {}
    const create = vi.fn(() => createRetentionGuard(vi.fn(), vi.fn()))
    const first = retentionGuardOf(form, create)
    expect(retentionGuardOf(form, create)).toBe(first)
    expect(retentionGuardOf({}, create)).not.toBe(first)
    expect(create).toHaveBeenCalledTimes(2)
  })
})
