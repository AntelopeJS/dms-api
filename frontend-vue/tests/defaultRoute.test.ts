import { beforeEach, describe, expect, it, vi } from 'vitest'

type Middleware = (to: {
  path: string
  query: Record<string, string>
}) => unknown

const ROUTES = [
  {
    ref: 'GET /health',
    method: 'GET',
    path: '/health',
    folder: '/health',
    state: 'healthy',
    requests: 90,
  },
  {
    ref: 'POST /orders',
    method: 'POST',
    path: '/orders',
    folder: '/orders',
    state: 'failing',
    requests: 4,
  },
]

const authFetch = vi.fn()
const cookie = { value: null as string | null }
const session = { loggedIn: { value: true } }

async function load(): Promise<Middleware> {
  vi.resetModules()
  vi.stubGlobal('defineDmsMiddleware', (handler: Middleware) => handler)
  vi.stubGlobal('useDmsUserSession', () => session)
  vi.stubGlobal('useAuthFetch', () => ({ $authFetch: authFetch }))
  vi.stubGlobal('useDmsCookie', () => cookie)
  return (await import('../app/middleware/defaultRoute')).default as Middleware
}

describe('the Routes page opened without a route', () => {
  beforeEach(() => {
    authFetch.mockReset().mockResolvedValue({ routes: ROUTES })
    cookie.value = null
    session.loggedIn.value = true
  })

  it('lands on the route needing a look first, the query kept', async () => {
    const middleware = await load()
    await expect(
      middleware({ path: '/modules/api/routes', query: { tab: 'tester' } }),
    ).resolves.toEqual({
      path: '/modules/api/routes',
      query: { tab: 'tester', route: 'POST /orders' },
    })
    expect(authFetch).toHaveBeenCalledWith('/api/monitoring/routes/list')
  })

  it('lands on the route last opened in the session', async () => {
    cookie.value = 'GET /health'
    const middleware = await load()
    await expect(
      middleware({ path: '/modules/api/routes', query: {} }),
    ).resolves.toMatchObject({ query: { route: 'GET /health' } })
  })

  it('leaves alone a visit naming a route, and the other pages', async () => {
    const middleware = await load()
    await expect(
      middleware({
        path: '/modules/api/routes',
        query: { route: 'GET /health' },
      }),
    ).resolves.toBeUndefined()
    await expect(
      middleware({ path: '/modules/api/logs', query: {} }),
    ).resolves.toBeUndefined()
    expect(authFetch).not.toHaveBeenCalled()
  })

  it('opens the page as it is signed out or without the list', async () => {
    session.loggedIn.value = false
    const middleware = await load()
    await expect(
      middleware({ path: '/modules/api/routes', query: {} }),
    ).resolves.toBeUndefined()
    expect(authFetch).not.toHaveBeenCalled()

    session.loggedIn.value = true
    authFetch.mockRejectedValue(new Error('offline'))
    await expect(
      middleware({ path: '/modules/api/routes', query: {} }),
    ).resolves.toBeUndefined()
  })
})
