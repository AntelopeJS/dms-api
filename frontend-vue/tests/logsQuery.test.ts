import { describe, expect, it } from 'vitest'
import {
  bodyLimit,
  clearedLogsFilters,
  hasLogsFilters,
  isRouteRef,
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
  it('tells a route reference from anything else', () => {
    expect(isRouteRef('GET /api/orders')).toBe(true)
    expect(isRouteRef('garbage')).toBe(false)
  })
})
