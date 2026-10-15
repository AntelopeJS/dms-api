import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, shallowRef } from 'vue'
import {
  apiResourceKey,
  errorStatus,
  useApiResource,
} from '../app/composables/useApiResource'
import { useRouteDetail } from '../app/composables/useRouteDetail'

// `useApiResource` and `useRouteDetail` over `useApiData` (AntelopeJS/dms):
// what they show of the reads `useApiData` runs, as the DMS documents them
// (a reactive key keeps the previous data on screen until the next one is
// in, a failure stays until the next answer and keeps the data).

type Status = 'idle' | 'pending' | 'success' | 'error'

interface FetchCall {
  url: string
  signal: AbortSignal
}

interface HandlerContext {
  $authFetch: (
    url: string,
    options: { signal: AbortSignal },
  ) => Promise<unknown>
  signal: AbortSignal
}

interface FakeRead {
  key: () => string | null
  handler: (context: HandlerContext) => Promise<unknown>
  options: { refreshOnPageRefresh?: boolean }
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
    (
      key: FakeRead['key'],
      handler: FakeRead['handler'],
      options: FakeRead['options'],
    ) => {
      const read: FakeRead = {
        key,
        handler,
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

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** `useApiData` running the caller's handler, its fetch answering `value`. */
async function answer(read: FakeRead, value: unknown): Promise<FetchCall[]> {
  const calls: FetchCall[] = []
  const signal = new AbortController().signal
  read.data.value = await read.handler({
    $authFetch: async (url, options) => {
      calls.push({ url, signal: options.signal })
      return value
    },
    signal,
  })
  read.error.value = null
  read.status.value = 'success'
  return calls
}

describe('useApiResource', () => {
  it('reads its URL under a key of its own, the URL and the time kept with the payload', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const resource = useApiResource<{ n: number }>(() => '/api/a')
    const [read] = reads
    // Not the URL's own key: `useApiData('/api/a')` keeps the bare response.
    expect(read!.key()).toBe('dms-api:resource:/api/a')
    expect(read!.key()).toBe(apiResourceKey('/api/a'))
    read!.status.value = 'pending'
    expect(resource.pending.value).toBe(true)
    const calls = await answer(read!, { n: 1 })
    expect(calls.map((call) => call.url)).toEqual(['/api/a'])
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal)
    expect(read!.data.value).toEqual({
      url: '/api/a',
      value: { n: 1 },
      at: 1_700_000_000_000,
    })
    expect(resource.data.value).toEqual({ n: 1 })
    expect(resource.receivedAt.value).toBe(1_700_000_000_000)
    expect(resource.pending.value).toBe(false)
  })

  it('follows the page refreshes unless told otherwise', () => {
    useApiResource<string>(() => '/api/a')
    useApiResource<string>(() => '/api/b', { refreshOnPageRefresh: false })
    expect(reads.map((read) => read.options.refreshOnPageRefresh)).toEqual([
      undefined,
      false,
    ])
  })

  it('shows nothing of the previous URL while the next one loads', async () => {
    const url = ref('/api/a')
    const resource = useApiResource<string>(() => url.value)
    const [read] = reads
    await answer(read!, 'A')
    // useApiData keeps the previous payload while it reads the next key.
    url.value = '/api/b'
    expect(read!.key()).toBe('dms-api:resource:/api/b')
    read!.status.value = 'pending'
    expect(resource.data.value).toBeNull()
    expect(resource.pending.value).toBe(true)
    expect(resource.refreshing.value).toBe(false)
    expect(resource.receivedAt.value).toBeNull()
    await answer(read!, 'B')
    expect(resource.data.value).toBe('B')
  })

  it('refreshes over the data on screen', async () => {
    const resource = useApiResource<string>(() => '/api/a')
    const [read] = reads
    await answer(read!, 'A')
    read!.status.value = 'pending'
    expect(resource.data.value).toBe('A')
    expect(resource.pending.value).toBe(false)
    expect(resource.refreshing.value).toBe(true)
    void resource.refresh()
    expect(read!.refresh).toHaveBeenCalledOnce()
  })

  it('shows the failure useApiData keeps until the next answer', async () => {
    const resource = useApiResource<string>(() => '/api/a')
    const [read] = reads
    await answer(read!, 'A')
    const failure = { statusCode: 503 }
    read!.error.value = failure
    read!.status.value = 'error'
    expect(resource.data.value).toBe('A')
    expect(resource.error.value).toEqual(failure)
    read!.status.value = 'pending'
    expect(resource.error.value).toEqual(failure)
    await answer(read!, 'A2')
    expect(resource.error.value).toBeNull()
    expect(resource.data.value).toBe('A2')
  })

  it('reads nothing without a URL', () => {
    const resource = useApiResource<string>(() => null)
    expect(reads[0]!.key()).toBeNull()
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
    expect(reads.map((read) => read.key())).toEqual([null, null])
    routeQuery.value = { route: 'GET /orders' }
    // One key for both: useApiData shares its data.
    expect(reads.map((read) => read.key())).toEqual([
      'dms-api:resource:/api/routes/detail?route=GET+%2Forders',
      'dms-api:resource:/api/routes/detail?route=GET+%2Forders',
    ])
    // The header reads it again on its own tab only.
    expect(reads.map((read) => read.options.refreshOnPageRefresh)).toEqual([
      false,
      false,
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
    // useApiData keeps the failure until the refresh answers.
    read!.status.value = 'pending'
    expect(detail.missing.value).toBe(true)
  })
})
