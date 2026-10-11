import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bodyOmission,
  dayStarts,
  decodePath,
  durationScale,
  hrefWithRecord,
  isRequestId,
  listedRequestIds,
  navigationAmong,
  OPEN_REQUEST_EVENT,
  OPEN_REQUEST_KEY,
  openRequestMiddleware,
  openRequestRedirect,
  originalBodySize,
  readRecord,
  redactionsOf,
  REQUEST_ACTION_ICON,
  REQUEST_ACTION_SELECTOR,
  REQUEST_PANEL,
  requestActionSelector,
  requestClock,
  requestOfActionId,
  requestPivots,
  requestTitle,
  requestUrl,
  thresholdRatio,
  withParam,
  withRecord,
  writeRecord,
} from '../app/utils/requestDrawer'

const LOGS = '/modules/api/logs'
const ROUTES = '/modules/api/routes'
const ORIGIN = 'http://console.test'

describe('requestDrawer', () => {
  it('opens a row over the query the page already has', () => {
    expect(
      openRequestRedirect(
        { path: ROUTES, query: { [OPEN_REQUEST_KEY]: 'r1' } },
        {
          path: ROUTES,
          query: { route: 'GET /users/:id', tab: 'statistics' },
        },
      ),
    ).toEqual({
      path: ROUTES,
      query: { route: 'GET /users/:id', tab: 'statistics', record: 'r1' },
    })
  })

  it('replaces the request already open', () => {
    expect(
      openRequestRedirect(
        { path: LOGS, query: { [OPEN_REQUEST_KEY]: 'r2' } },
        { path: LOGS, query: { error: 'boom', record: 'r1' } },
      ),
    ).toEqual({ path: LOGS, query: { error: 'boom', record: 'r2' } })
  })

  it('keeps nothing of another page', () => {
    expect(
      openRequestRedirect(
        { path: LOGS, query: { [OPEN_REQUEST_KEY]: 'r1' } },
        { path: ROUTES, query: { route: 'GET /users' } },
      ),
    ).toEqual({ path: LOGS, query: { record: 'r1' } })
  })

  it('leaves every other visit alone', () => {
    expect(
      openRequestRedirect(
        { path: LOGS, query: { record: 'r1' } },
        { path: LOGS, query: {} },
      ),
    ).toBeUndefined()
    expect(
      openRequestRedirect(
        { path: LOGS, query: { [OPEN_REQUEST_KEY]: '' } },
        { path: LOGS, query: {} },
      ),
    ).toBeUndefined()
  })

  it('reads and writes the open request', () => {
    expect(readRecord({ record: 'r1' })).toBe('r1')
    expect(readRecord({ record: '' })).toBeNull()
    expect(readRecord({})).toBeNull()
    expect(withRecord({ route: 'GET /', record: 'r1' })).toEqual({
      route: 'GET /',
    })
    expect(withRecord({ route: 'GET /' }, 'r2')).toEqual({
      route: 'GET /',
      record: 'r2',
    })
    expect(hrefWithRecord(`${ORIGIN}${LOGS}?slow=true&record=r1`)).toBe(
      `${ORIGIN}${LOGS}?slow=true`,
    )
  })
})

describe('the rows of a request table', () => {
  const buttonId = (id: string) => `row-action-${id}-${REQUEST_ACTION_ICON}`

  it('reads a row id from its action button, whatever the id holds', () => {
    const id = '0359c490-1b2c-4d5e-8f90-123456789abc'
    expect(requestOfActionId(buttonId(id))).toBe(id)
    expect(requestOfActionId('row-action-r1-i-ph-pencil')).toBeNull()
    expect(requestOfActionId('row-actions-r1')).toBeNull()
    expect(requestOfActionId(null)).toBeNull()
    expect(requestActionSelector('r1')).toBe(`button[id="${buttonId('r1')}"]`)
    expect(requestActionSelector('a"b')).toContain('a\\"b')
  })

  it('lists the rows the tables show, in order, once each', () => {
    const buttons = ['a', 'a', 'b', 'c', 'b'].map((id) => ({
      getAttribute: (name: string) => (name === 'id' ? buttonId(id) : null),
    }))
    const root = {
      querySelectorAll: (selector: string) =>
        selector === REQUEST_ACTION_SELECTOR ? buttons : [],
    } as unknown as ParentNode
    expect(listedRequestIds(root)).toEqual(['a', 'b', 'c'])
  })

  it('steps to the neighbours of the open row', () => {
    const step = vi.fn()
    const navigation = navigationAmong(['a', 'b', 'c'], 'b', step)!
    expect(navigation).toMatchObject({
      index: 1,
      total: 3,
      hasPrev: true,
      hasNext: true,
    })
    navigation.next()
    navigation.prev()
    expect(step.mock.calls).toEqual([['c'], ['a']])
    const last = navigationAmong(['a', 'b'], 'b', step)!
    expect(last.hasNext).toBe(false)
    last.next()
    expect(step).toHaveBeenCalledTimes(2)
    expect(navigationAmong(['a'], 'z', step)).toBeNull()
  })

  it('cuts a table by day only when it runs through time', () => {
    const today = '2026-10-10'
    const yesterday = '2026-10-09'
    expect(dayStarts([today, today, yesterday, yesterday])).toEqual([2])
    expect(dayStarts([today, today])).toEqual([])
    // Sorted on duration: the days interleave, no line is drawn.
    expect(dayStarts([today, yesterday, today])).toEqual([])
  })
})

describe('history', () => {
  /**
   * The browser's session history, as far as the panel touches it: its
   * entries, the one on screen, and the `popstate` a traverse fires, which
   * Inertia answers by mounting the page anew.
   */
  function browser(href: string) {
    // Inertia's state of the entry: its page, its scroll positions.
    const inertia = { page: { component: 'Logs', url: LOGS } }
    const entries = [{ state: inertia as unknown, url: href }]
    let index = 0
    const popstate = vi.fn()
    const dispatchEvent = vi.fn()
    const location = {
      get href() {
        return entries[index].url
      },
      get pathname() {
        return new URL(entries[index].url).pathname
      },
    }
    const history = {
      get state() {
        return entries[index].state
      },
      get length() {
        return entries.length
      },
      pushState: vi.fn((state: unknown, _title: string, url: string) => {
        entries.splice(index + 1, entries.length, { state, url })
        index++
      }),
      replaceState: vi.fn((state: unknown, _title: string, url: string) => {
        entries[index] = { state, url }
      }),
      back: vi.fn(() => {
        if (index === 0) return
        index--
        popstate(entries[index].state)
      }),
    }
    vi.stubGlobal('window', { location, history, dispatchEvent })
    vi.stubGlobal(
      'CustomEvent',
      class {
        constructor(
          public type: string,
          public init: { detail: unknown },
        ) {}
      },
    )
    return { inertia, history, location, popstate, dispatchEvent }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens a row in place, without a visit or a history entry', () => {
    const { history, location, dispatchEvent, inertia } = browser(
      `${ORIGIN}${LOGS}?slow=true`,
    )
    const result = openRequestMiddleware(
      { path: LOGS, query: { [OPEN_REQUEST_KEY]: 'r1' } },
      { path: LOGS, query: { slow: 'true' } },
    )
    expect(result).toBe(false)
    expect(location.href).toBe(`${ORIGIN}${LOGS}?slow=true&record=r1`)
    expect(history.pushState).not.toHaveBeenCalled()
    expect(history.length).toBe(1)
    // Inertia's state of the entry is the same object: nothing to restore.
    expect(history.state).toBe(inertia)
    const [event] = dispatchEvent.mock.calls[0]
    expect(event.type).toBe(OPEN_REQUEST_EVENT)
    expect(event.init.detail).toEqual({ id: 'r1' })
  })

  it('opens, steps and closes without a traverse Inertia would answer', () => {
    const start = `${ORIGIN}${LOGS}?window=24h`
    const { history, location, popstate, inertia } = browser(start)
    openRequestMiddleware(
      { path: LOGS, query: { [OPEN_REQUEST_KEY]: 'r1' } },
      { path: LOGS, query: { window: '24h' } },
    )
    // Another row clicked, then J: the request open is replaced.
    openRequestMiddleware(
      { path: LOGS, query: { [OPEN_REQUEST_KEY]: 'r2' } },
      { path: LOGS, query: { window: '24h' } },
    )
    writeRecord('r3')
    expect(location.href).toBe(`${ORIGIN}${LOGS}?window=24h&record=r3`)
    // ✕ or Esc.
    writeRecord()
    expect(location.href).toBe(start)
    expect(history.length).toBe(1)
    expect(history.pushState).not.toHaveBeenCalled()
    expect(history.back).not.toHaveBeenCalled()
    expect(popstate).not.toHaveBeenCalled()
    expect(history.state).toBe(inertia)
  })

  it('closes a deep link in place, its entry kept', () => {
    const { history, location } = browser(
      `${ORIGIN}${LOGS}?record=r1&slow=true`,
    )
    writeRecord()
    expect(location.href).toBe(`${ORIGIN}${LOGS}?slow=true`)
    expect(history.length).toBe(1)
  })

  it('visits another page with the request open', () => {
    const { history } = browser(`${ORIGIN}${ROUTES}`)
    expect(
      openRequestMiddleware(
        { path: LOGS, query: { [OPEN_REQUEST_KEY]: 'r1' } },
        { path: ROUTES, query: {} },
      ),
    ).toEqual({ path: LOGS, query: { record: 'r1' } })
    expect(history.pushState).not.toHaveBeenCalled()
    expect(history.replaceState).not.toHaveBeenCalled()
  })
})

describe('reading a request', () => {
  it('decodes a path as people read it, and leaves a broken one as is', () => {
    expect(decodePath('/api/orders/commande-%C3%A9')).toBe(
      '/api/orders/commande-é',
    )
    expect(decodePath('/a%2Fb')).toBe('/a%2Fb')
    expect(decodePath('/bad-%E0%A4%A')).toBe('/bad-%E0%A4%A')
  })

  it('names a request and the URL it went to', () => {
    expect(
      requestTitle({
        method: 'post',
        rawPath: '/webhooks/stripe',
        statusCode: 500,
      }),
    ).toBe('POST /webhooks/stripe · 500')
    expect(
      requestUrl('https://api.test', '/orders', { status: ['a', 'b'], q: 'é' }),
    ).toBe('https://api.test/orders?status=a&status=b&q=%C3%A9')
    expect(requestUrl('', '/orders', undefined)).toBe('/orders')
  })

  it('writes the day only once it is not today', () => {
    const now = new Date(2026, 9, 10, 18, 0, 0)
    expect(
      requestClock(new Date(2026, 9, 10, 17, 2, 28), 'en-GB', false, now),
    ).toBe('17:02:28')
    expect(
      requestClock(new Date(2026, 9, 9, 23, 42, 10), 'en-GB', false, now),
    ).toBe('Yesterday, 23:42:10')
    expect(
      requestClock(new Date(2026, 9, 9, 23, 42, 10), 'fr-FR', false, now),
    ).toBe('Hier, 23:42:10')
    expect(
      requestClock(new Date(2026, 9, 8, 12, 0, 0), 'en-GB', false, now),
    ).toBe('8 Oct, 12:00:00')
  })

  it('scales a duration against the slow threshold', () => {
    expect(durationScale(500, 1000)).toEqual({
      share: 25,
      threshold: 50,
      ratio: 0.5,
      slow: false,
      max: 2000,
    })
    const slow = durationScale(6886, 1000)
    expect(slow.slow).toBe(true)
    expect(slow.share).toBe(100)
    expect(slow.threshold).toBeCloseTo(14.5, 1)
    expect(slow.ratio).toBeCloseTo(6.886)
    expect(durationScale(1010, 1000).share).toBeCloseTo(50.5)
  })

  it('knows why a body is missing and how big it was', () => {
    expect(bodyOmission('too-large')).toBe('too-large')
    expect(bodyOmission('something')).toBeNull()
    expect(bodyOmission(null)).toBeNull()
    expect(originalBodySize(65_536, true, 184_051, {})).toBe(184_051)
    expect(
      originalBodySize(65_536, true, undefined, { 'Content-Length': '184051' }),
    ).toBe(184_051)
    expect(
      originalBodySize(11, true, undefined, { 'content-length': '11' }),
    ).toBeUndefined()
  })

  it('compares a whole body to nothing: masking changed its length only', () => {
    // 5 values masked: 249 bytes stored of the 260 sent, nothing cut.
    expect(
      originalBodySize(249, false, null, { 'content-length': '260' }),
    ).toBeUndefined()
    expect(originalBodySize(249, undefined, 260, {})).toBeUndefined()
  })

  it('writes a ratio to the threshold that never reads as zero', () => {
    expect(thresholdRatio(2.189, 'en-GB')).toBe('2.2')
    expect(thresholdRatio(0.4, 'fr-FR')).toBe('0,4')
    expect(thresholdRatio(0.036, 'en-GB')).toBe('< 0.1')
    expect(thresholdRatio(0.036, 'fr-FR')).toBe('< 0,1')
    expect(thresholdRatio(0, 'en-GB')).toBe('< 0.1')
  })

  it('names a body never read by a handler', () => {
    expect(bodyOmission('not-read')).toBe('not-read')
  })

  it('reads what the capture masked, or counts it on an older log', () => {
    expect(
      redactionsOf({
        redactions: {
          query: 1,
          requestBody: 2,
          responseBody: 0,
          headers: ['x-api-key'],
        },
        requestBody: '{}',
      }),
    ).toEqual({
      query: 1,
      requestBody: 2,
      responseBody: 0,
      headers: ['x-api-key'],
    })
    expect(
      redactionsOf({
        query: { token: '[REDACTED]', page: '2', ids: ['[REDACTED]', '3'] },
        requestBody: '{"password":"[REDACTED]","card":"[REDACTED]"}',
      }),
    ).toEqual({ query: 2, requestBody: 2, responseBody: 0, headers: [] })
  })

  it('tells a request id from what a link may hold', () => {
    expect(isRequestId('0359c490-1b2c-4d5e-8f90-123456789abc')).toBe(true)
    expect(isRequestId('<script>/../settings')).toBe(false)
  })

  describe('the lists a request leads to', () => {
    const log = {
      rawPath: '/api/orders',
      routeRegistered: true,
      responseTimeMs: 36,
      slowThresholdMs: 1000,
      links: { sameRoute: '/modules/api/logs?route=POST+%2Fapi%2Forders' },
    }

    it('leads a request no route matched to its path, not to an empty route list', () => {
      expect(
        requestPivots({
          ...log,
          rawPath: '/nope/qa-rd-notread',
          routeRegistered: false,
          responseTimeMs: null,
          links: {
            sameRoute: '/modules/api/logs?route=POST+%2Fnope%2Fqa-rd-notread',
          },
        }),
      ).toEqual([
        {
          kind: 'same_path',
          to: '/modules/api/logs?path=%2Fnope%2Fqa-rd-notread',
        },
      ])
    })

    it('offers slow requests once the route has some', () => {
      const kinds = (value: Parameters<typeof requestPivots>[0]) =>
        requestPivots(value).map((pivot) => pivot.kind)
      const latency = { windowDays: 7, p50: 40, p95: 900 }
      // Without the route's figures: the request itself tells.
      expect(kinds(log)).toEqual(['same_route'])
      expect(kinds({ ...log, responseTimeMs: 2189 })).toEqual([
        'same_route',
        'slow_route',
      ])
      expect(kinds({ ...log, routeLatency: { ...latency, slow: 0 } })).toEqual([
        'same_route',
      ])
      expect(
        requestPivots({ ...log, routeLatency: { ...latency, slow: 3 } })[1],
      ).toEqual({
        kind: 'slow_route',
        to: '/modules/api/logs?route=POST+%2Fapi%2Forders&slow=true',
      })
      expect(
        kinds({
          ...log,
          rawPath: '/api/orders/42',
          links: { ...log.links, samePath: '/modules/api/logs?path=x' },
        }),
      ).toEqual(['same_route', 'same_path'])
    })
  })

  it('leaves a laptop room for the page next to the docked panel', () => {
    const sidebar = 240
    expect(1280 - sidebar - REQUEST_PANEL.defaultWidth).toBeGreaterThanOrEqual(
      600,
    )
    expect(REQUEST_PANEL.minWidth).toBeLessThanOrEqual(
      REQUEST_PANEL.defaultWidth,
    )
  })

  it('adds a parameter to a link', () => {
    expect(
      withParam('/modules/api/logs?route=GET+%2Forders', 'slow', 'true'),
    ).toBe('/modules/api/logs?route=GET+%2Forders&slow=true')
  })
})
