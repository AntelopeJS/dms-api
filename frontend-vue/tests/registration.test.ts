import { expect, it, vi } from 'vitest'

/** Loads the module entry with the DMS's auto-imported helpers it calls on load. */
async function loadModule() {
  vi.stubGlobal('defineDmsPlugin', <T>(setup: T) => setup)
  vi.stubGlobal('defineDmsMiddleware', <T>(handler: T) => handler)
  const [
    { default: frontendModule },
    { default: displays },
    { default: defaultRoute },
  ] = await Promise.all([
    import('../dms.frontend'),
    import('../app/plugins/displays'),
    import('../app/middleware/defaultRoute'),
  ])
  return { frontendModule, displays, defaultRoute }
}

it('registers the blocks the backend pages name, and nothing else', async () => {
  const { frontendModule, displays, defaultRoute } = await loadModule()
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
  expect(registerPlugin).toHaveBeenCalledWith(displays, { clientOnly: false })
  // One middleware, on every visit: the Routes page opened without a route
  // lands on one, on the server too. The request drawer and its URL are the DMS's.
  expect(registerMiddleware).toHaveBeenCalledTimes(1)
  expect(registerMiddleware).toHaveBeenCalledWith(
    'dms-api-default-route',
    defaultRoute,
    { global: true },
  )
})
