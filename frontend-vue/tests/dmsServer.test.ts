import { describe, expect, it, vi } from 'vitest'
import setup from '../dms.server'
import { testerRoute } from '../server/tester'

interface Registration {
  method: unknown
  path: string
  handler: unknown
  options: object | undefined
}

function registrations(): Registration[] {
  const routes: Registration[] = []
  setup({
    registerRoute: (method, path, handler, options) =>
      void routes.push({ method, path, handler, options }),
    registerAuth: vi.fn(),
    registerRouteRules: vi.fn(),
    registerBackendProxy: vi.fn(),
  })
  return routes
}

describe('dms.server.ts', () => {
  it("serves the tester's POST under the module's own namespace, and nothing else", () => {
    expect(registrations()).toEqual([
      {
        method: 'POST',
        path: '/api/_dms-api/tester',
        handler: testerRoute,
        options: undefined,
      },
    ])
  })
})
