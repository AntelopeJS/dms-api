import { describe, expect, it } from 'vitest'
import {
  isPeriodWindow,
  queryWithWindow,
  readStoredWindow,
  readWindow,
  storeWindow,
  WINDOW_PRESETS,
  WINDOW_STORAGE_KEY,
  windowStart,
  type WindowStorage,
} from '../app/utils/periodWindow'

describe('readWindow', () => {
  it('reads the period a page query names', () => {
    expect(readWindow({ window: '24h' })).toBe('24h')
    expect(readWindow({ scope: 'all', window: ['30d', '7d'] })).toBe('30d')
  })

  it('ignores a period the pages do not offer', () => {
    expect(readWindow({ window: '14d' })).toBeUndefined()
    expect(readWindow({})).toBeUndefined()
  })
})

describe('queryWithWindow', () => {
  it('sets the period and keeps every other parameter', () => {
    expect(queryWithWindow({ route: 'GET /a', tab: '2' }, '1h')).toEqual({
      route: 'GET /a',
      tab: '2',
      window: '1h',
    })
  })

  it('replaces the period already there', () => {
    expect(queryWithWindow({ window: '7d' }, '24h')).toEqual({ window: '24h' })
  })
})

describe('the presets', () => {
  it('resolve every window to a DMS period preset', () => {
    expect(WINDOW_PRESETS).toEqual({
      '1h': 'last-hour',
      '24h': 'last-24h',
      '7d': 'last-7-days',
      '30d': 'last-30-days',
    })
    expect(isPeriodWindow('7d')).toBe(true)
    expect(isPeriodWindow('last-7-days')).toBe(false)
  })

  it('roll back from now', () => {
    const now = Date.UTC(2026, 9, 10, 18)
    expect(windowStart('24h', now).toISOString()).toBe(
      '2026-10-09T18:00:00.000Z',
    )
    expect(windowStart('7d', now).toISOString()).toBe(
      '2026-10-03T18:00:00.000Z',
    )
  })
})

describe('the period kept for the module', () => {
  function memory(): WindowStorage & { values: Map<string, string> } {
    const values = new Map<string, string>()
    return {
      values,
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
    }
  }

  it('keeps the last period under one key for every page', () => {
    const storage = memory()
    storeWindow(storage, '24h')
    storeWindow(storage, '30d')
    expect(storage.values.get(WINDOW_STORAGE_KEY)).toBe('30d')
    expect(readStoredWindow(storage)).toBe('30d')
  })

  it('keeps only the periods every page offers', () => {
    const storage = memory()
    storeWindow(storage, 'all')
    storeWindow(storage, undefined)
    expect(readStoredWindow(storage)).toBeUndefined()
    storage.values.set(WINDOW_STORAGE_KEY, '14d')
    expect(readStoredWindow(storage)).toBeUndefined()
  })

  it('does without storage, refused or absent', () => {
    const refused: WindowStorage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(() => storeWindow(refused, '7d')).not.toThrow()
    expect(readStoredWindow(refused)).toBeUndefined()
    expect(readStoredWindow(undefined)).toBeUndefined()
  })
})
