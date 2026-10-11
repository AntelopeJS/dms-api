import { expect, it, vi } from 'vitest'
import frontendModule from '../dms.frontend'

vi.mock('../app/plugins/displays', () => ({ default: () => {} }))
vi.mock('../app/plugins/requestPanel', () => ({ default: () => {} }))

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
      'LogsPeriod',
      'RequestDetail',
      'RequestDrawerHost',
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
  // Both universal: the cell displays, and the side panel a request opens
  // in, which a reload renders open.
  expect(registerPlugin).toHaveBeenCalledTimes(2)
  for (const [, options] of registerPlugin.mock.calls)
    expect(options).toEqual({ clientOnly: false })
  // A row opens its request over the page's query, whatever page it is on.
  expect(registerMiddleware).toHaveBeenCalledWith(
    'dms-api-open-request',
    expect.any(Function),
    { global: true },
  )
  // A link to the request logs opens on the "All" tab, after the above.
  expect(registerMiddleware.mock.calls.map(([name]) => name)).toEqual([
    'dms-api-open-request',
    'dms-api-logs-arrival',
  ])
  for (const [, , options] of registerMiddleware.mock.calls)
    expect(options).toEqual({ global: true })
})
