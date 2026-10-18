import { expect, it, vi } from 'vitest'
import frontendModule from '../dms.frontend'

vi.mock('../app/plugins/displays', () => ({ default: () => {} }))
vi.mock('../app/middleware/defaultRoute', () => ({ default: () => {} }))

it('registers the blocks the backend pages name, and nothing else', async () => {
  const registerComponent = vi.fn()
  const registerPlugin = vi.fn()
  const registerMiddleware = vi.fn()
  await frontendModule.setup({
    options: { public: {} },
    registerComponent,
    registerPage: vi.fn(),
    registerDynamicPage: vi.fn(),
    registerLayout: vi.fn(),
    registerErrorPage: vi.fn(),
    registerPlugin,
    registerMiddleware,
    provide: vi.fn(),
    use: vi.fn(),
  })
  expect(frontendModule.componentPrefix).toBe('DmsApi')
  const names = registerComponent.mock.calls.map(([name]) => name)
  expect(names).toEqual(
    expect.arrayContaining([
      'LiveTraffic',
      'LogsEmptyState',
      'LogsFilters',
      'RequestDetail',
      'RouteTree',
      'RouteHeader',
      'RouteDocumentation',
      'RouteTester',
      'ScopeChip',
      'SplitLayout',
    ]),
  )
  expect(names).not.toContain('ApiMethodBadge')
  expect(new Set(names).size).toBe(names.length)
  // Universal: the cell displays draw in the server render too.
  expect(registerPlugin).toHaveBeenCalledTimes(1)
  expect(registerPlugin.mock.calls[0]?.[1]).toEqual({ clientOnly: false })
  // One middleware, on every visit: the Routes page opened without a route
  // lands on one, on the server too. The side panel and its URL are the DMS's.
  expect(registerMiddleware).toHaveBeenCalledTimes(1)
  expect(registerMiddleware.mock.calls[0]?.[0]).toBe('dms-api-default-route')
  expect(registerMiddleware.mock.calls[0]?.[2]).toEqual({ global: true })
})
