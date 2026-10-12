import { computed, markRaw, onBeforeUnmount, ref, watch } from 'vue'
import type { RouteState } from '../utils/routeExplorer'

/** One step of the request pipeline of a route, in the order it runs. */
export interface PipelineStep {
  kind: 'prefix' | 'handler' | 'postfix' | 'monitor'
  name: string
  location: string
  priority?: number
  isAuth: boolean
}

export interface InferredField {
  name: string
  types: string[]
  required: boolean
  /** Its value in the most recent body that had it, when a scalar. */
  example?: string | number | boolean | null
}

export interface ParameterInfo {
  index: number
  name: string | null
  source: string
  multi: boolean
  inferredType: string
  modifierCount: number
  rawProviderSource?: string
  /** The decorator that provides it, as written in the code. */
  decorator?: string
  hint?: string
}

export interface PropertyInfo {
  key: string
  decorator: string
  modifierCount: number
  hint?: string
}

/** What is known of a route's authentication, from its code and traffic. */
export interface RouteAuth {
  status: 'required' | 'probable' | 'unknown'
  /** The guards found in the code. */
  guards: string[]
  /** 401 answers over the contract window. */
  unauthorized: number
}

/** A parameter of a route, declared in the code or seen in its traffic. */
export interface DocumentedParameter {
  name: string
  in: 'path' | 'query' | 'header'
  type: string
  example: string | null
  declared: boolean
  required: boolean
}

/** A status the route answered over the contract window. */
export interface ObservedStatus {
  status: number
  count: number
  /** The most frequent error message, null when none was recorded. */
  message: string | null
  /** The most frequent distinct error messages, most frequent first. */
  messages: Array<{ message: string; count: number }>
  /** Distinct error messages in all, `messages` included. */
  messageCount: number
  lastSeen: string
}

export interface RouteDetail {
  ref: string
  method: string
  path: string
  folder: string
  controller: string | null
  handler: string
  module: string | null
  own: boolean | null
  requiresAuth: boolean
  auth: RouteAuth
  registeredAt: string | null
  /**
   * The first day the route was called, from the statistics kept: never
   * further back than their retention. Null before any call.
   */
  firstCallAt?: string | null
  state: RouteState
  /** Minutes of traffic `state` is judged on, the same as the list's. */
  healthWindowMinutes?: number
  /** False when the route lies outside the active route scope. */
  inScope?: boolean
  /** False for a route the module leaves out of its logs (the console's own). */
  captured?: boolean
  /** The last call captured for the route, whatever the period. */
  lastCallAt?: string | null
  pathParams: string[]
  parameters: DocumentedParameter[]
  pipeline: PipelineStep[]
  inspection: {
    parameters: ParameterInfo[]
    properties: PropertyInfo[]
    errorCodes: Array<{ status: number; reason: string | null; source: string }>
    authGuards: string[]
  }
  contract: {
    /** The days the contract is read over, up to now. */
    windowDays: number
    /** Requests answered over the window, the tester's left out. */
    total: number
    exampleBody: unknown
    bodyFields: InferredField[]
    /** Successful requests the bodies and examples were read from. */
    sampled: number
    queryParams: string[]
    statuses: ObservedStatus[]
    /** Path and query of the most recent successful call. */
    examplePath: Record<string, string>
    exampleQuery: Record<string, string | string[]>
    exampleResponse: {
      status: number
      body: string
      json: boolean
      truncated: boolean
    } | null
    responseKind: 'object' | 'array' | null
    responseFields: InferredField[]
    /** Response time of the successful calls, null without any. */
    latency: { p50: number; p95: number } | null
  }
  /** Where clients reach the API, for the snippets; null when unknown. */
  apiOrigin: string | null
}

/** The detail every block of the page reads, fetched once per route. */
interface DetailSlot {
  url: string | null
  data: RouteDetail | null
  error: unknown
  pending: boolean
  refreshing: boolean
  receivedAt: number | null
}

const emptySlot = (): DetailSlot => ({
  url: null,
  data: null,
  error: null,
  pending: true,
  refreshing: false,
  receivedAt: null,
})

/** The request still running for a slot, and the blocks reading it. */
const running = new WeakMap<object, AbortController>()
const readers = new WeakMap<object, number>()

/**
 * The route the page's `?route=` names, shared by the blocks that show it:
 * the header, the documentation, the tester and the parts of the page that
 * wait for a valid route read one payload, loaded once per route rather than
 * once per block. A newer route cancels the request still running; a failed
 * refresh keeps the last data and says so through `error`.
 */
export function useRouteDetail(fetchUrl: string, queryKey = 'route') {
  const selection = useRouteSelection(queryKey)
  const target = computed(() =>
    selection.ref.value
      ? `${fetchUrl}?${new URLSearchParams({ route: selection.ref.value })}`
      : null,
  )

  // The server renders the page before anything is fetched.
  if (import.meta.env.SSR) {
    return {
      selection,
      missing: computed(() => false),
      data: ref<RouteDetail | null>(null),
      error: ref<unknown>(null),
      pending: ref(true),
      refreshing: ref(false),
      receivedAt: ref<number | null>(null),
      refresh: async () => {},
    }
  }

  const { $authFetch } = useAuthFetch()
  const state = useDmsState<DetailSlot>(
    `dms-api-route-detail:${fetchUrl}`,
    emptySlot,
  )

  async function load(url: string | null, force = false) {
    const slot = state.value
    if (!force && slot.url === url) return
    running.get(slot)?.abort()
    running.delete(slot)
    if (slot.url !== url) {
      slot.url = url
      slot.data = null
      slot.error = null
    }
    if (!url) {
      slot.pending = false
      return
    }
    const controller = new AbortController()
    running.set(slot, controller)
    slot.pending = slot.data === null
    slot.refreshing = slot.data !== null
    try {
      const response = await $authFetch<RouteDetail>(url, {
        signal: controller.signal,
      })
      if (running.get(slot) !== controller) return
      slot.data = markRaw(response)
      slot.error = null
      slot.receivedAt = Date.now()
    } catch (cause) {
      if (running.get(slot) !== controller) return
      if ((cause as { name?: string })?.name !== 'AbortError')
        slot.error = cause
    } finally {
      if (running.get(slot) === controller) {
        running.delete(slot)
        slot.pending = false
        slot.refreshing = false
      }
    }
  }

  // The first block of a page visit refreshes what an earlier visit left.
  const slot = state.value
  const count = readers.get(slot) ?? 0
  readers.set(slot, count + 1)
  onBeforeUnmount(() => readers.set(slot, (readers.get(slot) ?? 1) - 1))
  if (count === 0 && slot.url !== null) void load(target.value, true)

  watch(target, (url) => void load(url), { immediate: true })

  return {
    selection,
    missing: computed(() => errorStatus(state.value.error) === 404),
    data: computed(() => state.value.data),
    error: computed(() => state.value.error),
    pending: computed(() => state.value.pending),
    refreshing: computed(() => state.value.refreshing),
    receivedAt: computed(() => state.value.receivedAt),
    refresh: () => load(target.value, true),
  }
}
