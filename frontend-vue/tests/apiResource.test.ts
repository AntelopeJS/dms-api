import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref, shallowRef } from 'vue'
import { errorStatus, useApiResource } from '../app/composables/useApiResource'
import { useRouteDetail } from '../app/composables/useRouteDetail'

// `useApiResource` and `useRouteDetail` over `useApiData` (AntelopeJS/dms):
// what they show of the reads `useApiData` runs, as the DMS documents them
// (a reactive URL keeps the previous data on screen until the next one is
// in, a refresh clears `error` as it starts and keeps the data on a failure).

type Status = 'idle' | 'pending' | 'success' | 'error'

interface FakeRead {
  url: () => string | null | undefined
  options: { transform?: (value: unknown) => unknown; deep?: boolean }
  data: ReturnType<typeof shallowRef<unknown>>
  error: ReturnType<typeof ref<unknown>>
  status: ReturnType<typeof ref<Status>>
  refresh: ReturnType<typeof vi.fn>
}

let reads: FakeRead[] = []

beforeEach(() => {
  reads = []
  vi.stubGlobal(
    'useApiData',
    (url: FakeRead['url'], options: FakeRead['options']) => {
      const read: FakeRead = {
        url,
        options,
        data: shallowRef(null),
        error: ref(null),
        status: ref<Status>('idle'),
        refresh: vi.fn(async () => undefined),
      }
      reads.push(read)
      return read
    },
  )
  vi.stubGlobal('errorStatus', errorStatus)
  vi.stubGlobal('useApiResource', useApiResource)
})

afterEach(() => vi.unstubAllGlobals())

/** `useApiData` answering `url` with `value`, through the caller's transform. */
function answer(read: FakeRead, value: unknown) {
  read.data.value = read.options.transform!(value)
  read.error.value = null
  read.status.value = 'success'
}

describe('useApiResource', () => {
  it('reads its URL with useApiData, the URL and the time kept with the payload', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const resource = useApiResource<{ n: number }>(() => '/api/a')
    const [read] = reads
    expect(read!.url()).toBe('/api/a')
    expect(read!.options.deep).toBe(false)
    read!.status.value = 'pending'
    expect(resource.pending.value).toBe(true)
    answer(read!, { n: 1 })
    expect(read!.data.value).toEqual({
      url: '/api/a',
      value: { n: 1 },
      at: 1_700_000_000_000,
    })
    expect(resource.data.value).toEqual({ n: 1 })
    expect(resource.receivedAt.value).toBe(1_700_000_000_000)
    expect(resource.pending.value).toBe(false)
  })

  it('shows nothing of the previous URL while the next one loads', () => {
    const url = ref('/api/a')
    const resource = useApiResource<string>(() => url.value)
    const [read] = reads
    answer(read!, 'A')
    // useApiData keeps the previous payload while it reads the next URL.
    url.value = '/api/b'
    read!.status.value = 'pending'
    expect(resource.data.value).toBeNull()
    expect(resource.pending.value).toBe(true)
    expect(resource.refreshing.value).toBe(false)
    expect(resource.receivedAt.value).toBeNull()
    answer(read!, 'B')
    expect(resource.data.value).toBe('B')
  })

  it('refreshes over the data on screen', () => {
    const resource = useApiResource<string>(() => '/api/a')
    const [read] = reads
    answer(read!, 'A')
    read!.status.value = 'pending'
    expect(resource.data.value).toBe('A')
    expect(resource.pending.value).toBe(false)
    expect(resource.refreshing.value).toBe(true)
    void resource.refresh()
    expect(read!.refresh).toHaveBeenCalledOnce()
  })

  it('keeps a failure until the refresh after it answers', async () => {
    const resource = useApiResource<string>(() => '/api/a')
    const [read] = reads
    answer(read!, 'A')
    const failure = { statusCode: 503 }
    read!.error.value = failure
    read!.status.value = 'error'
    await nextTick()
    expect(resource.data.value).toBe('A')
    expect(resource.error.value).toEqual(failure)
    // useApiData clears its error as the refresh starts.
    read!.error.value = null
    read!.status.value = 'pending'
    expect(resource.error.value).toEqual(failure)
    answer(read!, 'A2')
    expect(resource.error.value).toBeNull()
    expect(resource.data.value).toBe('A2')
  })

  it('reads nothing without a URL', () => {
    const resource = useApiResource<string>(() => null)
    expect(reads[0]!.url()).toBeNull()
    expect(resource.pending.value).toBe(false)
    expect(resource.data.value).toBeNull()
  })
})

describe('useRouteDetail', () => {
  beforeEach(() => {
    const query = ref<Record<string, string>>({})
    vi.stubGlobal('useRouteSelection', (key: string) => ({
      ref: computed(() => query.value[key] ?? null),
    }))
    routeQuery = query
  })
  let routeQuery: ReturnType<typeof ref<Record<string, string>>>

  it('reads the detail of the route the URL names, shared by its blocks', () => {
    const header = useRouteDetail('/api/routes/detail')
    const tester = useRouteDetail('/api/routes/detail')
    expect(reads.map((read) => read.url())).toEqual([null, null])
    routeQuery.value = { route: 'GET /orders' }
    // One URL for both: useApiData shares its request.
    expect(reads.map((read) => read.url())).toEqual([
      '/api/routes/detail?route=GET+%2Forders',
      '/api/routes/detail?route=GET+%2Forders',
    ])
    expect(header.selection.ref.value).toBe('GET /orders')
    expect(tester.pending.value).toBe(false)
  })

  it('says a route is missing on a 404, while a refresh runs too', () => {
    routeQuery.value = { route: 'GET /gone' }
    const detail = useRouteDetail('/api/routes/detail')
    const [read] = reads
    read!.error.value = { statusCode: 404 }
    read!.status.value = 'error'
    expect(detail.missing.value).toBe(true)
    read!.error.value = null
    read!.status.value = 'pending'
    expect(detail.missing.value).toBe(true)
  })
})
