import { afterEach, expect, it, vi } from 'vitest'
import { sendTesterRequest } from '../app/utils/testerRequest'

afterEach(() => vi.unstubAllGlobals())

it('forwards raw requests through the owner BFF without copying session credentials', async () => {
  const reply = {
    status: 422,
    headers: { 'content-type': 'application/json' },
    body: '{"invalid":true}',
  }
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(reply)))
  vi.stubGlobal('fetch', fetch)
  const result = await sendTesterRequest(
    '/playground/notes/abc%2Fdef?view=raw',
    'https://dms.example',
    {
      method: 'PATCH',
      headers: { Authorization: 'Bearer explicit', 'X-Fixture': 'custom' },
      body: 'raw body',
      useSession: false,
    },
  )
  expect(result).toEqual(reply)
  expect(fetch).toHaveBeenCalledWith('/api/_dms/tester', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      method: 'PATCH',
      headers: { Authorization: 'Bearer explicit', 'X-Fixture': 'custom' },
      body: 'raw body',
      useSession: false,
      path: '/playground/notes/abc%2Fdef?view=raw',
    }),
  })
})

it('normalizes a same-origin absolute URL and retains session mode', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ status: 200, headers: {}, body: 'ok' })),
    )
  vi.stubGlobal('fetch', fetch)
  await sendTesterRequest(
    'https://dms.example/settings/test?x=1',
    'https://dms.example',
    { method: 'GET', headers: {}, useSession: true },
  )
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    method: 'GET',
    headers: {},
    useSession: true,
    path: '/settings/test?x=1',
  })
})

it.each([
  'https://foreign.example/api/private',
  '//foreign.example/api/private',
  '/\\foreign.example/api/private',
  'https://name:password@dms.example/api/private',
  '/api/private#fragment',
  'api/private',
])('rejects unsafe target %s before any request', async (target) => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await expect(
    sendTesterRequest(target, 'https://dms.example', {
      method: 'GET',
      headers: {},
      useSession: true,
    }),
  ).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
})

it('reports BFF authorization failures rather than pretending they are upstream responses', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response('{"error":"Forbidden"}', { status: 403 }),
      ),
  )
  await expect(
    sendTesterRequest('/api/private', 'https://dms.example', {
      method: 'GET',
      headers: {},
      useSession: true,
    }),
  ).rejects.toThrow('403')
})
