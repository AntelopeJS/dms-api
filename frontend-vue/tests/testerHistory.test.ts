import { beforeEach, describe, expect, it } from 'vitest'
import {
  type HistoryEntry,
  loadHistory,
  saveHistory,
} from '../app/utils/testerHistory'

const store = new Map<string, string>()
Object.assign(globalThis, {
  window: {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  },
})

function entry(at: number): HistoryEntry {
  return {
    at,
    path: '/api/orders',
    headers: {
      Authorization: 'Bearer secret',
      'content-type': 'application/json',
    },
    query: {},
    pathValues: {},
    body: '{}',
    useSession: true,
    result: {
      status: 201,
      durationMs: 12,
      headers: {},
      body: 'x'.repeat(10_000),
      sentWithSession: true,
    },
  }
}

describe('tester history', () => {
  beforeEach(() => store.clear())

  it('keeps 25 calls per route, without credentials or huge bodies', () => {
    saveHistory(
      'POST /api/orders',
      Array.from({ length: 30 }, (_, index) => entry(index)),
    )
    const saved = loadHistory('POST /api/orders')
    expect(saved).toHaveLength(25)
    expect(saved[0].headers).toEqual({ 'content-type': 'application/json' })
    expect(saved[0].result.body.length).toBe(4096)
  })

  it('ignores what it cannot read', () => {
    store.set('dmsApi.tester.history.GET /x', '{not json')
    expect(loadHistory('GET /x')).toEqual([])
  })
})
