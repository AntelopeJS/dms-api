import { describe, expect, it } from 'vitest'
import { fillPath, toCurl, toFetch, withQuery } from '../app/utils/snippets'
import { closestMatch } from '../app/utils/search'
import { formatClock, formatMs, prettyBody } from '../app/utils/format'

describe('snippets', () => {
  const request = {
    method: 'post',
    url: 'https://api.acme.test/api/orders',
    headers: { 'content-type': 'application/json' },
    body: `{"note":"it's"}`,
  }

  it('writes a cURL command that survives quotes', () => {
    expect(toCurl(request)).toBe(
      [
        "curl -X POST 'https://api.acme.test/api/orders'",
        "  -H 'content-type: application/json'",
        `  -d '{"note":"it'\\''s"}'`,
      ].join(' \\\n'),
    )
  })

  it('writes a fetch call', () => {
    expect(toFetch(request)).toContain('method: "POST"')
  })

  it('fills path params and leaves the empty ones visible', () => {
    expect(fillPath('/api/orders/:id/lines/:line', { id: 'A 1' })).toBe(
      '/api/orders/A%201/lines/:line',
    )
    expect(withQuery('/api/orders', { page: '2', empty: '' })).toBe(
      '/api/orders?page=2',
    )
  })
})

describe('closestMatch', () => {
  it('finds the route a typo meant', () => {
    expect(
      closestMatch('refnd', ['/api/orders/:id/refund', '/api/customers']),
    ).toBe('/api/orders/:id/refund')
    expect(closestMatch('zzzzzz', ['/api/orders'])).toBeNull()
  })
})

describe('format', () => {
  it('writes durations and times of requests', () => {
    expect(formatMs(48, 'en')).toBe('48 ms')
    expect(formatMs(12_400, 'en')).toBe('12.4 s')
    const now = new Date('2026-10-07T14:31:58.412')
    expect(formatClock(now, 'en', true, now)).toBe('14:31:58.412')
    expect(formatClock(new Date('2026-09-28T14:31:58'), 'en', false, now)).toBe(
      'Sep 28, 14:31:58',
    )
  })

  it('pretty-prints JSON bodies only', () => {
    expect(prettyBody('{"a":1}')).toEqual({
      text: '{\n  "a": 1\n}',
      json: true,
    })
    expect(prettyBody('plain')).toEqual({ text: 'plain', json: false })
  })
})
