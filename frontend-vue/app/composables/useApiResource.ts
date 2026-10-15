import { computed, shallowRef, watch, type Ref } from 'vue'

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

/** A response, with the URL it answers and when it came. */
interface Received<T> {
  url: string
  value: T
  at: number
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
): ApiResource<T> {
  const read = useApiData<Received<T>>(url, {
    // The URL and the time travel with the payload: the browser shows the
    // time the server received it.
    transform: (value) => ({
      url: url() as string,
      value: value as T,
      at: Date.now(),
    }),
    deep: false,
  })
  const current = computed(() => {
    const received = read.data.value
    return received && received.url === url() ? received : null
  })
  const running = computed(() => read.status.value === 'pending')

  // `useApiData` clears its error as a refresh starts: the last answer's is
  // kept until the refresh answers.
  const answered = shallowRef<unknown>(read.error.value)
  watch(
    read.status,
    (status) => {
      if (status !== 'pending') answered.value = read.error.value
    },
    { flush: 'sync' },
  )

  return {
    data: computed(() => current.value?.value ?? null),
    error: computed(() => (running.value ? answered.value : read.error.value)),
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
