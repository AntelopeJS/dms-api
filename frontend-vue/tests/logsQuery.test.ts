import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bodyLimit,
  clearedLogsFilters,
  hasLogsFilters,
  isRouteRef,
  logsArrival,
  logsArrivalMiddleware,
  shownTab,
  routeLabel,
  withDefaultWindow,
  logsEmptyCause,
  readLogsFilters,
  routeMethod,
  withLogsFilters,
} from '../app/utils/logsQuery'

describe('readLogsFilters', () => {
  it('reads the filters a link or the page wrote', () => {
    expect(
      readLogsFilters({
        window: '24h',
        method: 'POST',
        slow: 'true',
        route: 'POST /webhooks/stripe',
        error: 'boom',
        from: 'overview',
      }),
    ).toEqual({
      window: '24h',
      method: 'POST',
      slow: true,
      route: 'POST /webhooks/stripe',
      error: 'boom',
      since: undefined,
      until: undefined,
      from: 'overview',
    })
  })

  it('leaves out what the table would not apply', () => {
    expect(
      readLogsFilters({ window: '14d', method: 'post', slow: '1', from: 'x' }),
    ).toEqual({
      window: undefined,
      method: undefined,
      slow: false,
      route: undefined,
      error: undefined,
      since: undefined,
      until: undefined,
      from: undefined,
    })
  })

  it('takes the first of repeated values', () => {
    expect(readLogsFilters({ window: ['7d', '1h'] }).window).toBe('7d')
  })
})

describe('withLogsFilters', () => {
  it('sets and removes filters, keeping the rest of the query', () => {
    expect(
      withLogsFilters(
        { 'requests.tab': '5xx', record: 'r1', method: 'GET' },
        { window: '1h', method: null, slow: true },
      ),
    ).toEqual({
      'requests.tab': '5xx',
      record: 'r1',
      window: '1h',
      slow: 'true',
    })
  })

  it('forgets the origin once the period changes', () => {
    expect(
      withLogsFilters(
        { route: 'GET /a', window: '24h', from: 'overview' },
        { window: '7d' },
      ),
    ).toEqual({ route: 'GET /a', window: '7d' })
  })

  it('forgets the origin with the last linked filter', () => {
    expect(
      withLogsFilters(
        { route: 'GET /a', error: 'boom', from: 'routes' },
        { route: null },
      ),
    ).toEqual({ error: 'boom', from: 'routes' })
    expect(
      withLogsFilters({ error: 'boom', from: 'routes' }, { error: null }),
    ).toEqual({})
  })

  it('clears every filter, not the tab', () => {
    expect(
      clearedLogsFilters({
        window: '24h',
        method: 'GET',
        slow: 'true',
        route: 'GET /a',
        error: 'boom',
        from: 'overview',
        'requests.tab': '4xx',
      }),
    ).toEqual({ 'requests.tab': '4xx' })
  })
})

describe('routeMethod', () => {
  it('reads the method a route reference fixes', () => {
    expect(routeMethod('post /webhooks/stripe')).toBe('POST')
    expect(routeMethod('garbage')).toBeUndefined()
    expect(routeMethod(undefined)).toBeUndefined()
  })
})

describe('logsEmptyCause', () => {
  const none = readLogsFilters({})

  it('names the most specific cause', () => {
    expect(logsEmptyCause('error', 'x', none)).toBe('error')
    expect(
      logsEmptyCause('filtered', 'zzzz', readLogsFilters({ route: 'GET /a' })),
    ).toBe('search')
    // The DMS says first run: the URL's filters are not its own.
    expect(
      logsEmptyCause('firstRun', '', readLogsFilters({ route: 'GET /a' })),
    ).toBe('link')
    expect(
      logsEmptyCause('firstRun', ' ', readLogsFilters({ window: '1h' })),
    ).toBe('filters')
    expect(logsEmptyCause('firstRun', undefined, none)).toBe('first-run')
  })
})

describe('bodyLimit', () => {
  it('does not round a small limit down to 0 KB', () => {
    expect(bodyLimit(0)).toEqual({ unit: 'none', amount: 0 })
    expect(bodyLimit(300)).toEqual({ unit: 'b', amount: 300 })
    expect(bodyLimit(65_536)).toEqual({ unit: 'kb', amount: 64 })
    expect(bodyLimit(1_536)).toEqual({ unit: 'kb', amount: 1.5 })
  })
})

describe('incident range', () => {
  const incident = {
    route: 'GET /a',
    since: '2026-10-10T18:31:00.000Z',
    until: '2026-10-10T18:46:00.000Z',
    window: '24h',
    from: 'overview',
    'requests.tab': '5xx',
  }

  it('reads the range and drops an unreadable one', () => {
    expect(readLogsFilters(incident)).toMatchObject({
      since: incident.since,
      until: incident.until,
    })
    expect(readLogsFilters({ since: 'soon' }).since).toBeUndefined()
  })

  it('drops the range with a new period or on its own', () => {
    expect(withLogsFilters(incident, { window: '7d' })).toEqual({
      route: 'GET /a',
      window: '7d',
      'requests.tab': '5xx',
    })
    expect(withLogsFilters(incident, { incident: null })).toEqual({
      route: 'GET /a',
      window: '24h',
      from: 'overview',
      'requests.tab': '5xx',
    })
  })

  it('keeps the origin while the range alone is left', () => {
    expect(withLogsFilters(incident, { route: null })).toMatchObject({
      since: incident.since,
      from: 'overview',
    })
  })

  it('counts as a link filter for the empty state', () => {
    expect(
      logsEmptyCause(
        'firstRun',
        '',
        readLogsFilters({ since: incident.since }),
      ),
    ).toBe('link')
  })
})

describe('the default period', () => {
  it('applies 24 hours when the URL names none', () => {
    expect(withDefaultWindow(readLogsFilters({})).window).toBe('24h')
    expect(withDefaultWindow(readLogsFilters({ window: '7d' })).window).toBe(
      '7d',
    )
  })

  it('counts every period but All as a filter', () => {
    expect(hasLogsFilters(withDefaultWindow(readLogsFilters({})))).toBe(true)
    expect(hasLogsFilters(readLogsFilters({ window: '30d' }))).toBe(true)
    expect(readLogsFilters({ window: 'all' }).window).toBe('all')
    expect(hasLogsFilters(readLogsFilters({ window: 'all' }))).toBe(false)
  })
})

describe('route chips', () => {
  it('names a route without the trailing slash of an older link', () => {
    expect(routeLabel('post /webhooks/stripe/')).toBe('POST /webhooks/stripe')
    expect(isRouteRef('GET /api/orders')).toBe(true)
    expect(isRouteRef('garbage')).toBe(false)
  })
})

describe('logsArrival', () => {
  const logs = '/modules/api/logs'
  const overview = { path: '/modules/api/overview', query: {} }

  it('opens a link on the All tab rather than the one kept', () => {
    expect(
      logsArrival({ path: logs, query: { route: 'GET /a' } }, overview),
    ).toEqual({
      to: { path: logs, query: { route: 'GET /a', 'requests.tab': 'all' } },
      reload: false,
    })
  })

  it('loads the page anew over a table mounted without the tab', () => {
    const to = { path: logs, query: { error: 'boom' } }
    expect(logsArrival(to, to)).toEqual({
      to: { path: logs, query: { error: 'boom', 'requests.tab': 'all' } },
      reload: true,
    })
  })

  it('loads the page anew for a link followed by a visit within it', () => {
    const from = { path: logs, query: { record: 'r1', 'requests.tab': 'all' } }
    expect(logsArrival({ path: logs, query: { path: '/x' } }, from)).toEqual({
      to: { path: logs, query: { path: '/x', 'requests.tab': 'all' } },
      reload: true,
    })
    // A tab the link names is the one opened.
    const named = {
      path: logs,
      query: { route: 'GET /a', 'requests.tab': '5xx' },
    }
    expect(logsArrival(named, from)).toEqual({ to: named, reload: true })
  })

  it('leaves a named tab, a bare visit and the filters bar alone', () => {
    const named = {
      path: logs,
      query: { route: 'GET /a', 'requests.tab': '5xx' },
    }
    expect(logsArrival(named, overview)).toBeUndefined()
    expect(logsArrival(named, named)).toBeUndefined()
    expect(logsArrival({ path: logs, query: {} }, undefined)).toBeUndefined()
    const linked = { path: logs, query: { route: 'GET /a', error: 'boom' } }
    // A period chosen, a chip removed: no link brought.
    expect(
      logsArrival(
        { path: logs, query: { ...linked.query, window: '7d' } },
        linked,
      ),
    ).toBeUndefined()
    expect(
      logsArrival({ path: logs, query: { route: 'GET /a' } }, linked),
    ).toBeUndefined()
    expect(
      logsArrival(
        { path: '/modules/api/routes', query: { route: 'GET /a' } },
        linked,
      ),
    ).toBeUndefined()
  })
})

describe('logsArrivalMiddleware', () => {
  const logs = '/modules/api/logs'

  afterEach(() => vi.unstubAllGlobals())

  it('redirects where no table is mounted, and in a server render', () => {
    expect(
      logsArrivalMiddleware(
        { path: logs, query: { route: 'GET /a' } },
        { path: '/modules/api/overview', query: {} },
      ),
    ).toEqual({ path: logs, query: { route: 'GET /a', 'requests.tab': 'all' } })
    const to = { path: logs, query: { route: 'GET /a' } }
    expect(logsArrivalMiddleware(to, to)).toEqual({
      path: logs,
      query: { route: 'GET /a', 'requests.tab': 'all' },
    })
  })

  it('loads the page anew over a mounted table', () => {
    const location = { assign: vi.fn(), replace: vi.fn() }
    vi.stubGlobal('window', { location })
    const from = { path: logs, query: { record: 'r1' } }
    expect(
      logsArrivalMiddleware({ path: logs, query: { path: '/a b' } }, from),
    ).toBe(false)
    expect(location.assign).toHaveBeenCalledWith(
      '/modules/api/logs?path=%2Fa+b&requests.tab=all',
    )
    const shown = { path: logs, query: { path: '/x' } }
    expect(logsArrivalMiddleware(shown, shown)).toBe(false)
    expect(location.replace).toHaveBeenCalledWith(
      '/modules/api/logs?path=%2Fx&requests.tab=all',
    )
  })
})

describe('shownTab', () => {
  function card(labels: string[], shown: number | null) {
    const parent = { children: [] as unknown[] }
    const tabs = labels.map((textContent) => ({
      textContent,
      parentElement: parent,
    }))
    parent.children = tabs
    return {
      querySelector: () => (shown === null ? null : tabs[shown]),
    }
  }

  it('reads the first tab as All, whatever its label, and a class by its label', () => {
    expect(shownTab(card(['Tous 1 204', '2xx 900', '5xx 12'], 0))).toBe('all')
    expect(shownTab(card(['All 1,204', '2xx 900', '5xx 12'], 2))).toBe('5xx')
    expect(shownTab(card([], null))).toBeUndefined()
  })
})
