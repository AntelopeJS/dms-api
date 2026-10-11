import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPacer,
  hasPending,
  isLiveShortcut,
  latestTime,
  liveCadence,
  liveStatus,
  NO_PENDING,
  pendingFrom,
  reasonsKey,
  sinceQuery,
  storedPaused,
  urlPaused,
  verdictChange,
} from '../app/utils/liveMode'

describe('liveStatus', () => {
  const live = { userPaused: false, reasons: [], override: null }

  it('is live by default', () => {
    expect(liveStatus(live)).toEqual({ mode: 'live', reason: null })
  })

  it('pauses by itself, naming the most telling reason', () => {
    expect(liveStatus({ ...live, reasons: ['tester'] })).toEqual({
      mode: 'auto',
      reason: 'tester',
    })
  })

  it('lifts the automatic pause with its cause', () => {
    const paused = liveStatus({ ...live, reasons: ['tester'] })
    const closed = liveStatus({ ...live, reasons: [] })
    expect(paused.mode).toBe('auto')
    expect(closed.mode).toBe('live')
  })

  it("keeps the user's own pause when the cause goes", () => {
    const user = { ...live, userPaused: true }
    expect(liveStatus({ ...user, reasons: ['tester'] }).mode).toBe('paused')
    expect(liveStatus(user).mode).toBe('paused')
  })

  it('stays live over the reasons the user chose Live over, not new ones', () => {
    const override = reasonsKey(['tester'])
    expect(liveStatus({ ...live, reasons: ['tester'], override }).mode).toBe(
      'live',
    )
    expect(
      liveStatus({ ...live, reasons: ['tester', 'hidden'], override }),
    ).toEqual({ mode: 'auto', reason: 'hidden' })
  })

  it('always stops in a hidden tab', () => {
    expect(
      liveStatus({
        userPaused: true,
        reasons: ['hidden'],
        override: 'hidden',
      }),
    ).toEqual({ mode: 'auto', reason: 'hidden' })
  })
})

describe('the kept choice', () => {
  it('is Live unless the user paused, and ?live=0 freezes a view', () => {
    expect(storedPaused(null)).toBe(false)
    expect(storedPaused('live')).toBe(false)
    expect(storedPaused('paused')).toBe(true)
    expect(urlPaused({ live: '0' })).toBe(true)
    expect(urlPaused({ live: ['0'] })).toBe(true)
    expect(urlPaused({ live: '1' })).toBe(false)
    expect(urlPaused({})).toBe(false)
  })
})

describe('liveCadence', () => {
  it('paces each page, slower over a week or a month', () => {
    expect(liveCadence('logs')).toBe(5000)
    expect(liveCadence('overview', '24h')).toBe(10_000)
    expect(liveCadence('overview', '7d')).toBe(30_000)
    expect(liveCadence('routes', '24h')).toBe(15_000)
    expect(liveCadence('routes', '30d')).toBe(30_000)
  })
})

describe('createPacer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs at once, then folds the requests of the floor into one run', () => {
    const run = vi.fn()
    const pacer = createPacer(() => 5000, run)
    pacer.request()
    expect(run).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    pacer.request()
    pacer.request()
    pacer.request()
    expect(run).toHaveBeenCalledTimes(1)
    expect(pacer.waiting()).toBe(true)
    vi.advanceTimersByTime(3999)
    expect(run).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(2)
    expect(pacer.waiting()).toBe(false)
  })

  it('never runs twice within its floor under a steady stream', () => {
    const runs: number[] = []
    const pacer = createPacer(
      () => 10_000,
      () => runs.push(Date.now()),
    )
    for (let second = 0; second < 60; second++) {
      pacer.request()
      vi.advanceTimersByTime(1000)
    }
    // At 0 s, 10 s… 60 s: one a floor, and none lost.
    expect(runs.length).toBe(7)
    for (let index = 1; index < runs.length; index++)
      expect(runs[index] - runs[index - 1]).toBeGreaterThanOrEqual(10_000)
  })

  it('waits a whole floor after a touch: what was just loaded', () => {
    const run = vi.fn()
    const pacer = createPacer(() => 5000, run)
    pacer.touch()
    pacer.request()
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('drops a waiting run on cancel, and runs at once on force', () => {
    const run = vi.fn()
    const pacer = createPacer(() => 5000, run)
    pacer.request()
    pacer.request()
    pacer.cancel()
    vi.advanceTimersByTime(10_000)
    expect(run).toHaveBeenCalledTimes(1)
    pacer.force()
    expect(run).toHaveBeenCalledTimes(2)
  })
})

describe('the count of new requests', () => {
  it('reads a /since answer, whatever it holds', () => {
    expect(
      pendingFrom({ count: 23, serverErrors: 4, tester: 1, results: [] }),
    ).toEqual({ count: 23, serverErrors: 4, tester: 1 })
    expect(pendingFrom({ count: -1, serverErrors: 'x' })).toEqual(NO_PENDING)
    expect(pendingFrom(null)).toEqual(NO_PENDING)
  })

  it('has something to show with API requests or the Tester’s', () => {
    expect(hasPending(NO_PENDING)).toBe(false)
    expect(hasPending({ count: 0, serverErrors: 0, tester: 2 })).toBe(true)
    expect(hasPending({ count: 3, serverErrors: 1, tester: 0 })).toBe(true)
  })

  it('counts after the newest row on screen', () => {
    expect(
      latestTime([
        '2026-10-10T12:00:01.000Z',
        null,
        'yesterday',
        '2026-10-10T12:00:05.500Z',
      ]),
    ).toBe('2026-10-10T12:00:05.500Z')
    expect(latestTime([null, undefined])).toBeNull()
  })

  it("asks under the page's URL filters, without reading a row", () => {
    const after = '2026-10-10T12:00:00.000Z'
    const logs = sinceQuery({
      page: 'logs',
      after,
      query: { route: 'GET /api/orders', slow: 'true', window: '24h' },
    })
    expect(Object.fromEntries(logs)).toEqual({
      after,
      limit: '0',
      filter_route: 'is:GET /api/orders',
      filter_slow: 'is:true',
    })
    const routes = sinceQuery({
      page: 'routes',
      after,
      query: { route: 'POST /api/orders', tab: '0' },
      routeKey: 'route',
    })
    expect(Object.fromEntries(routes)).toEqual({
      after,
      limit: '0',
      filter_route: 'is:POST /api/orders',
    })
    const overview = sinceQuery({
      page: 'overview',
      after,
      query: { route: 'GET /x' },
    })
    expect(Object.fromEntries(overview)).toEqual({ after, limit: '0' })
  })

  it("keeps to an incident's range", () => {
    const after = '2026-10-10T12:00:00.000Z'
    const logs = sinceQuery({
      page: 'logs',
      after,
      query: {
        since: '2026-10-10T08:00:00.000Z',
        until: '2026-10-10T09:00:00.000Z',
      },
    })
    expect(Object.fromEntries(logs)).toEqual({
      after,
      limit: '0',
      filter_from: 'is:2026-10-10T08:00:00.000Z',
      filter_to: 'is:2026-10-10T09:00:00.000Z',
    })
    const routes = sinceQuery({
      page: 'routes',
      after,
      query: { since: '2026-10-10T08:00:00.000Z' },
    })
    expect(Object.fromEntries(routes)).toEqual({ after, limit: '0' })
  })
})

describe('isLiveShortcut', () => {
  const key = (init: Partial<Parameters<typeof isLiveShortcut>[0]>) => ({
    key: 'l',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    target: null,
    ...init,
  })
  const field = { closest: (selector: string) => selector.includes('input') }

  it('takes a bare L, not in a field nor with a modifier', () => {
    expect(isLiveShortcut(key({}))).toBe(true)
    expect(isLiveShortcut(key({ key: 'L' }))).toBe(true)
    expect(isLiveShortcut(key({ target: field }))).toBe(false)
    expect(isLiveShortcut(key({ ctrlKey: true }))).toBe(false)
    expect(isLiveShortcut(key({ repeat: true }))).toBe(false)
    expect(isLiveShortcut(key({ key: 'k' }))).toBe(false)
  })
})

describe('verdictChange', () => {
  it('tells a verdict that is no longer the one on screen', () => {
    expect(verdictChange('degraded', 'down')).toEqual({
      from: 'degraded',
      to: 'down',
    })
    expect(verdictChange('degraded', 'degraded')).toBeNull()
    expect(verdictChange('degraded', null)).toBeNull()
    expect(verdictChange(null, 'down')).toBeNull()
  })
})
