import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { useApiErrorPresenter } from '#dms-core/app/composables/useApiErrorPresenter'
import { useTesterState } from '../app/components/internal/routeTester/useTesterState'
import { useTesterFlow } from '../app/components/internal/routeTester/useTesterFlow'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('tester error presentation', () => {
  it.each(['send', 'source', 'replay'])(
    'shows one translated warning for a JSON 403 during %s',
    async (failureAt) => {
      vi.stubEnv('SSR', false)
      const notices: unknown[] = []
      const response = new Response(
        JSON.stringify({
          message: 'error.read_only_demo',
          severity: 'warning',
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      )
      const failure = Object.assign(new Error('Forbidden'), {
        response,
        data: await response.clone().json(),
      })
      const messages = {
        'error.read_only_demo': 'Read-only demo, changes are not saved',
        'error.500.description': 'Something went wrong',
      }
      vi.stubGlobal('getPluginI18n', () => ({
        i18n: {
          tm: (key: string) =>
            Object.hasOwn(messages, key) ? Reflect.get(messages, key) : {},
          rt: (message: string) => message,
        },
      }))
      const presented = ref(new WeakMap())
      vi.stubGlobal('useDmsState', () => presented)
      vi.stubGlobal('useApiErrorPresenter', useApiErrorPresenter)
      vi.stubGlobal('fetch', async () => response)
      vi.stubGlobal('window', { location: { origin: 'https://demo.example' } })
      vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
      vi.stubGlobal('useRegionalFormat', () => ({ formatLocale: ref('en') }))
      vi.stubGlobal('useDateFormat', () => ref('en'))
      vi.stubGlobal('useToast', () => ({
        add: (notice: unknown) => {
          notices.push(notice)
          return { id: notices.length }
        },
      }))
      vi.stubGlobal('useConfirm', () => ({ confirm: async () => true }))
      vi.stubGlobal('useDmsUserSession', () => ({ loggedIn: ref(true) }))
      vi.stubGlobal('useDmsRoute', () => ({ query: {} }))
      vi.stubGlobal('useDmsRouter', () => ({ replace: vi.fn() }))
      vi.stubGlobal('useAuthFetch', () => ({
        $authFetch: async () => {
          if (failureAt === 'source') throw failure
          return {
            value: 'tester.token',
            expiresAt: new Date(Date.now() + 120_000).toISOString(),
          }
        },
      }))
      vi.stubGlobal('useRouteDetail', () => ({
        data: ref({
          ref: 'GET /api/items',
          method: 'GET',
          path: '/api/items',
          pathParams: [],
          auth: { status: 'public' },
          contract: {},
        }),
        pending: ref(false),
        selection: {},
      }))
      vi.stubGlobal('useApiOrigin', () => ref('https://demo.example'))
      vi.stubGlobal('useApiData', () => ({
        data: ref(null),
        error: ref(failure),
        execute: async () => {},
      }))
      const scope = effectScope()
      const tester = scope.run(() => {
        const state = useTesterState({ fetchUrl: '/routes', queryKey: 'route' })
        state.session.activeRef = 'GET /api/items'
        return { ...state, ...useTesterFlow(state) }
      })
      if (!tester) throw new Error('Tester setup failed')
      try {
        if (failureAt !== 'send')
          useApiErrorPresenter().presentError(failure, {
            fallbackKey: 'error.500.description',
          })
        if (failureAt === 'replay')
          await tester.replay('log-1', 'GET /api/items')
        else await tester.send()
        expect(notices).toEqual([
          expect.objectContaining({
            title: 'Read-only demo, changes are not saved',
            color: 'warning',
          }),
        ])
        expect(tester.sending.value).toBe(false)
        expect(tester.session.inFlight).toBeNull()
        expect(tester.result.value).toBeNull()
        expect(tester.history.value).toEqual([])
      } finally {
        scope.stop()
      }
    },
  )
})
