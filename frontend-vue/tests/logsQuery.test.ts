import { describe, expect, it } from 'vitest'
import {
  bodyLimit,
  clearedLogsFilters,
  hasLogsFilters,
  isRouteRef,
  withDefaultPeriod,
  logsEmptyCause,
  readLogsFilters,
  routeMethod,
  withLogsFilters,
} from '../app/utils/logsQuery'
import { readPeriod } from '../app/utils/period'

describe('readLogsFilters', () => {
  it('reads the filters a link or the page wrote', () => {
    expect(
      readLogsFilters({
        'api.period': 'last-24h',
        method: 'POST',
        slow: 'true',
        route: 'POST /webhooks/stripe',
        error: 'boom',
        from: 'overview',
      }),
    ).toEqual({
      period: 'last-24h',
      all: false,
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
      readLogsFilters({
        'api.period': '14d',
        all: 'yes',
        method: 'post',
        slow: '1',
        from: 'x',
      }),
    ).toEqual({
      period: undefined,
      all: false,
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
    expect(readPeriod({ 'api.period': ['last-7-days', 'last-hour'] })).toBe(
      'last-7-days',
    )
  })
})

describe('withLogsFilters', () => {
  it('sets and removes filters, keeping the rest of the query', () => {
    expect(
      withLogsFilters(
        {
          'requests.tab': '5xx',
          record: 'r1',
          'api.period': 'last-hour',
          method: 'GET',
        },
        { all: true, method: null, slow: true },
      ),
    ).toEqual({
      'requests.tab': '5xx',
      record: 'r1',
      'api.period': 'last-hour',
      all: 'true',
      slow: 'true',
    })
  })

  it('forgets the origin once every period is asked for', () => {
    expect(
      withLogsFilters(
        { route: 'GET /a', 'api.period': 'last-24h', from: 'overview' },
        { all: true },
      ),
    ).toEqual({ route: 'GET /a', 'api.period': 'last-24h', all: 'true' })
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

  it('clears every filter, not the tab nor the period', () => {
    expect(
      clearedLogsFilters({
        'api.period': 'last-24h',
        all: 'true',
        method: 'GET',
        slow: 'true',
        route: 'GET /a',
        error: 'boom',
        from: 'overview',
        'requests.tab': '4xx',
      }),
    ).toEqual({ 'requests.tab': '4xx', 'api.period': 'last-24h' })
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
    // A period frames the rows.
    expect(logsEmptyCause('firstRun', ' ', none)).toBe('filters')
    expect(
      logsEmptyCause('firstRun', undefined, readLogsFilters({ all: 'true' })),
    ).toBe('first-run')
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
    'api.period': 'last-24h',
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

  it('drops the range with every period or on its own', () => {
    expect(withLogsFilters(incident, { all: true })).toEqual({
      route: 'GET /a',
      'api.period': 'last-24h',
      all: 'true',
      'requests.tab': '5xx',
    })
    expect(withLogsFilters(incident, { incident: null })).toEqual({
      route: 'GET /a',
      'api.period': 'last-24h',
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
  it('applies the last 24 hours when the URL names none', () => {
    expect(withDefaultPeriod(readLogsFilters({})).period).toBe('last-24h')
    expect(
      withDefaultPeriod(readLogsFilters({ 'api.period': 'last-7-days' }))
        .period,
    ).toBe('last-7-days')
  })

  it('leaves the period out of the filters to clear', () => {
    expect(hasLogsFilters(withDefaultPeriod(readLogsFilters({})))).toBe(false)
    expect(hasLogsFilters(readLogsFilters({ all: 'true' }))).toBe(false)
    expect(hasLogsFilters(readLogsFilters({ slow: 'true' }))).toBe(true)
  })
})

describe('route chips', () => {
  it('tells a route reference from anything else', () => {
    expect(isRouteRef('GET /api/orders')).toBe(true)
    expect(isRouteRef('garbage')).toBe(false)
  })
})
