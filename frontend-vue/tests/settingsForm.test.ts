import { describe, expect, it, vi } from 'vitest'
import {
  createRetentionGuard,
  isLinkedField,
  isLowered,
  numberAdjustment,
  parseTypedNumber,
  type RetentionChange,
  retentionGuardOf,
} from '../app/utils/settingsForm'

describe('parseTypedNumber', () => {
  it('reads a number as typed in the locale', () => {
    expect(parseTypedNumber('1020', 'en-GB')).toBe(1020)
    expect(parseTypedNumber('1,020', 'en-GB')).toBe(1020)
    expect(parseTypedNumber('1 020', 'fr-FR')).toBe(1020)
    expect(parseTypedNumber(' -100 ', 'en-GB')).toBe(-100)
  })

  it('is null when empty and NaN when not a number', () => {
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

  it('is null when the field holds what was typed, or nothing', () => {
    expect(numberAdjustment(2000, 2000, bounds)).toBeNull()
    expect(numberAdjustment(null, undefined, bounds)).toBeNull()
    expect(numberAdjustment(Number.NaN, undefined, bounds)).toBeNull()
  })
})

describe('isLinkedField', () => {
  it('matches the anchor the page was opened on', () => {
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
  const change = (field: string, to: number, from = 90): RetentionChange => ({
    field,
    label: field,
    from,
    to,
  })

  /** Confirms the changes the guard holds, then lets the resubmit through. */
  async function confirmAndResubmit(
    guard: ReturnType<typeof createRetentionGuard>,
    resubmit: ReturnType<typeof vi.fn>,
  ) {
    const before = resubmit.mock.calls.length
    expect(guard.allowSubmit()).toBe(false)
    await vi.waitFor(() => expect(resubmit.mock.calls.length).toBe(before + 1))
    expect(guard.allowSubmit()).toBe(true)
  }

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

    // Both fields' validators let the resubmit through.
    expect(guard.allowSubmit()).toBe(true)
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
    const resubmit = vi.fn()
    const guard = createRetentionGuard(ask, resubmit)
    guard.set('statisticsLifetimeDays', change('statisticsLifetimeDays', 60))
    await confirmAndResubmit(guard, resubmit)

    guard.set('statisticsLifetimeDays', change('statisticsLifetimeDays', 30))
    expect(guard.allowSubmit()).toBe(false)
    guard.set('statisticsLifetimeDays', null)
    expect(guard.allowSubmit()).toBe(true)
  })

  it('asks again for each lowering saved on the same page (90 → 30, 30 → 60, 60 → 30)', async () => {
    const ask = vi.fn(async () => true)
    const resubmit = vi.fn()
    const guard = createRetentionGuard(ask, resubmit)
    const field = 'statisticsLifetimeDays'

    guard.set(field, change(field, 30, 90))
    await confirmAndResubmit(guard, resubmit)
    expect(ask).toHaveBeenCalledTimes(1)
    // Saved: 30 is the value in force, nothing lowered.
    guard.set(field, null)

    // 30 → 60 raises it: no question.
    expect(guard.allowSubmit()).toBe(true)

    // Saved again at 60, then lowered to 30: asked again.
    guard.set(field, change(field, 30, 60))
    await confirmAndResubmit(guard, resubmit)
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('asks again for the same lowering once the form went back to its saved value', async () => {
    const ask = vi.fn(async () => true)
    const resubmit = vi.fn()
    const guard = createRetentionGuard(ask, resubmit)
    const field = 'statisticsLifetimeDays'

    guard.set(field, change(field, 30, 90))
    await confirmAndResubmit(guard, resubmit)
    guard.set(field, null)
    guard.set(field, change(field, 30, 90))
    expect(guard.allowSubmit()).toBe(false)
    await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(2))
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
