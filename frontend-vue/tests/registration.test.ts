import { expect, it, vi } from 'vitest'
import frontendModule from '../dms.frontend'

it('registers API dashboard components without leaking internal paths into their names', async () => {
  const registerComponent = vi.fn()
  await frontendModule.setup({
    options: { public: {} },
    registerComponent,
    registerPage: vi.fn(),
    registerDynamicPage: vi.fn(),
    registerLayout: vi.fn(),
    registerErrorPage: vi.fn(),
    registerPlugin: vi.fn(),
    registerMiddleware: vi.fn(),
    provide: vi.fn(),
    use: vi.fn(),
  })
  const names = registerComponent.mock.calls.map(([name]) => name)
  expect(names).toEqual(
    expect.arrayContaining([
      'DmsApiSummaryView',
      'DmsApiTesterPanel',
      'DmsApiPeriodSelect',
    ]),
  )
  expect(new Set(names).size).toBe(names.length)
  expect(names).not.toContain('DmsApiInternalPeriodSelect')
})
