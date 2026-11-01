import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { useTesterState } from '../app/components/internal/routeTester/useTesterState'
import { useTesterFlow } from '../app/components/internal/routeTester/useTesterFlow'

afterEach(() => vi.unstubAllGlobals())

describe('tester refusal presentation', () => {
  for (const marked of [true, false]) {
    it(
      marked
        ? 'shows one read-only notice without a result or history entry'
        : 'keeps an unmarked owner refusal visible',
      async () => {
        const notices: string[] = []
        const presented = new WeakSet<Response>()
        vi.stubGlobal('useReadOnlyRefusal', () => (error: unknown) => {
          if (!(error && typeof error === 'object' && 'response' in error))
            return false
          const response = error.response
          if (
            !(response instanceof Response) ||
            response.status !== 403 ||
            response.headers.get('x-dms-readonly') !== '1'
          )
            return false
          if (!presented.has(response))
            notices.push('Read-only demo, changes are not saved')
          presented.add(response)
          return true
        })
        vi.stubGlobal(
          'fetch',
          async () =>
            new Response('{}', {
              status: 403,
              headers: marked ? { 'x-dms-readonly': '1' } : {},
            }),
        )
        vi.stubGlobal('window', {
          location: { origin: 'https://demo.example' },
        })
        vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
        vi.stubGlobal('useRegionalFormat', () => ({ formatLocale: ref('en') }))
        vi.stubGlobal('useDateFormat', () => ref('en'))
        vi.stubGlobal('useToast', () => ({
          add: (notice: Record<'title', string>) => notices.push(notice.title),
        }))
        vi.stubGlobal('useConfirm', () => ({ confirm: async () => true }))
        vi.stubGlobal('useDmsUserSession', () => ({ loggedIn: ref(true) }))
        vi.stubGlobal('useDmsRoute', () => ({ query: {} }))
        vi.stubGlobal('useDmsRouter', () => ({ replace: vi.fn() }))
        vi.stubGlobal('useAuthFetch', () => ({
          $authFetch: async () => ({
            value: 'tester.token',
            expiresAt: new Date(Date.now() + 120_000).toISOString(),
          }),
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
          error: ref(null),
        }))
        const scope = effectScope()
        const tester = scope.run(() => {
          const state = useTesterState({
            fetchUrl: '/routes',
            queryKey: 'route',
          })
          state.session.activeRef = 'GET /api/items'
          return { ...state, ...useTesterFlow(state) }
        })!
        try {
          await tester.send()
          expect(tester.sending.value).toBe(false)
          expect(tester.session.inFlight).toBeNull()
          if (marked) {
            expect(notices).toEqual(['Read-only demo, changes are not saved'])
            expect(tester.result.value).toBeNull()
            expect(tester.history.value).toEqual([])
          } else {
            expect(notices).toEqual([])
            expect(tester.result.value?.error).toBe('not_owner')
            expect(tester.history.value).toHaveLength(1)
          }
        } finally {
          scope.stop()
        }
      },
    )
  }
})
