import { expect, it, vi } from 'vitest'
import frontendModule from '../dms.frontend'

vi.mock('../app/plugins/displays', () => ({ default: () => {} }))

it('registers the blocks the backend pages name, and nothing else', async () => {
  const registerComponent = vi.fn()
  const registerPlugin = vi.fn()
  await frontendModule.setup({
    options: { public: {} },
    registerComponent,
    registerPage: vi.fn(),
    registerDynamicPage: vi.fn(),
    registerLayout: vi.fn(),
    registerErrorPage: vi.fn(),
    registerPlugin,
    registerMiddleware: vi.fn(),
    provide: vi.fn(),
    use: vi.fn(),
  })
  expect(frontendModule.componentPrefix).toBe('DmsApi')
  const names = registerComponent.mock.calls.map(([name]) => name)
  expect(names).toEqual(
    expect.arrayContaining([
      'HealthHero',
      'LiveTraffic',
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
  expect(registerPlugin).toHaveBeenCalledWith(expect.any(Function), {
    clientOnly: false,
  })
})
