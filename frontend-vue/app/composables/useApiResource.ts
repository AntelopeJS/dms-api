import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'

export interface ApiResource<T> {
  data: Ref<T | null>
  error: Ref<unknown>
  /** First load still running: nothing to show yet. */
  pending: Ref<boolean>
  /** A refresh is running over data already on screen. */
  refreshing: Ref<boolean>
  /** When the data on screen was received. */
  receivedAt: Ref<number | null>
  refresh: () => Promise<void>
}

/**
 * A backend payload that follows a URL. A failed refresh keeps the last data
 * on screen and says so through `error`, instead of replacing the page with
 * an error box; a newer request cancels the one still running.
 */
export function useApiResource<T>(
  url: () => string | null | undefined,
): ApiResource<T> {
  const { $authFetch } = useAuthFetch()
  const data = shallowRef<T | null>(null)
  const error = ref<unknown>(null)
  const pending = ref(true)
  const refreshing = ref(false)
  const receivedAt = ref<number | null>(null)
  let controller: AbortController | null = null

  async function load(target: string | null | undefined) {
    controller?.abort()
    if (!target) {
      data.value = null
      pending.value = false
      return
    }
    const current = new AbortController()
    controller = current
    refreshing.value = data.value !== null
    try {
      const response = await $authFetch<T>(target, { signal: current.signal })
      if (controller !== current) return
      data.value = response
      error.value = null
      receivedAt.value = Date.now()
    } catch (cause) {
      if (controller !== current) return
      if ((cause as { name?: string })?.name !== 'AbortError')
        error.value = cause
    } finally {
      if (controller === current) {
        pending.value = false
        refreshing.value = false
      }
    }
  }

  watch(url, (target, previous) => {
    if (target === previous) return
    pending.value = true
    data.value = null
    void load(target)
  })

  if (import.meta.env.SSR) {
    pending.value = true
  } else {
    void load(url())
  }

  onBeforeUnmount(() => controller?.abort())

  return {
    data,
    error,
    pending,
    refreshing,
    receivedAt,
    refresh: () => load(url()),
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
