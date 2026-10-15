import { computed, type Ref } from 'vue'

export interface ApiResource<T> {
  data: Readonly<Ref<T | null>>
  error: Readonly<Ref<unknown>>
  /** First load still running: nothing to show yet. */
  pending: Readonly<Ref<boolean>>
  /** A refresh is running over data already on screen. */
  refreshing: Readonly<Ref<boolean>>
  /** When the data on screen was received. */
  receivedAt: Readonly<Ref<number | null>>
  refresh: () => Promise<void>
}

export interface ApiResourceOptions {
  /**
   * `false` for a resource its blocks read again on triggers of their own
   * (`usePageLiveRefresh`): the page's refreshes would read it a second time.
   */
  refreshOnPageRefresh?: boolean
}

/** A response, with the URL it answers and when it came. */
interface Received<T> {
  url: string
  value: T
  at: number
}

/**
 * The prefix of the keys `useApiResource` loads under. The payload it keeps
 * is its own shape (the response, its URL and its time), not the bare
 * response `useApiData(url)` keeps under the URL's own key: the two must not
 * share an entry.
 */
export const API_RESOURCE_KEY_PREFIX = 'dms-api:resource:'

/** The key of `url`'s resource, or `null` (nothing to read) without a URL. */
export function apiResourceKey(url: string | null | undefined): string | null {
  return url ? `${API_RESOURCE_KEY_PREFIX}${url}` : null
}

/**
 * A backend payload that follows a URL, read through `useApiData`: a server
 * render reads it and hands it over with the page, and the blocks reading the
 * same URL share it. Another URL shows nothing until its payload is in. A
 * failed refresh keeps the last data on screen and says so through `error`,
 * instead of replacing the page with an error box; the error stays while the
 * next refresh runs. A newer request cancels the one still running.
 */
export function useApiResource<T>(
  url: () => string | null | undefined,
  options: ApiResourceOptions = {},
): ApiResource<T> {
  const read = useApiData<Received<T>>(
    () => apiResourceKey(url()),
    // The URL and the time travel with the payload: the browser shows the
    // time the server received it.
    async ({ $authFetch, signal }) => {
      const target = url() as string
      const value = await $authFetch<T>(target, { signal })
      return { url: target, value: value as T, at: Date.now() }
    },
    { refreshOnPageRefresh: options.refreshOnPageRefresh },
  )
  const current = computed(() => {
    const received = read.data.value
    return received && received.url === url() ? received : null
  })
  const running = computed(() => read.status.value === 'pending')

  return {
    data: computed(() => current.value?.value ?? null),
    // `useApiData` keeps a failure until the next answer.
    error: computed(() => read.error.value),
    pending: computed(() => running.value && current.value === null),
    refreshing: computed(() => running.value && current.value !== null),
    receivedAt: computed(() => current.value?.at ?? null),
    refresh: () => read.refresh(),
  }
}

/** The HTTP status of a failed request, when it has one. */
export function errorStatus(error: unknown): number | undefined {
  const value = error as {
    statusCode?: number
    status?: number
    response?: { status?: number }
  }
  return value?.statusCode ?? value?.status ?? value?.response?.status
}
