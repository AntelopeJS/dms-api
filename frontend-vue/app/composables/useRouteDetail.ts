import { computed } from 'vue'

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
}

export interface ParameterInfo {
  index: number
  name: string | null
  source: string
  multi: boolean
  inferredType: string
  modifierCount: number
  rawProviderSource?: string
  hint?: string
}

export interface PropertyInfo {
  key: string
  decorator: string
  modifierCount: number
  hint?: string
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
  registeredAt: string | null
  state: 'failing' | 'slow' | 'client-errors' | 'healthy' | 'idle'
  pathParams: string[]
  pipeline: PipelineStep[]
  inspection: {
    parameters: ParameterInfo[]
    properties: PropertyInfo[]
    errorCodes: Array<{ status: number; reason: string | null; source: string }>
  }
  contract: {
    exampleBody: unknown
    bodyFields: InferredField[]
    queryParams: string[]
    statuses: Array<{ status: number; count: number; message: string | null }>
    sampled: number
  }
}

/**
 * The route the page's `?route=` names, shared by the blocks that show it:
 * the header, the documentation and the tester read the same payload.
 */
export function useRouteDetail(fetchUrl: string, queryKey = 'route') {
  const selection = useRouteSelection(queryKey)
  const resource = useApiResource<RouteDetail>(() =>
    selection.ref.value
      ? `${fetchUrl}?${new URLSearchParams({ route: selection.ref.value })}`
      : null,
  )
  const missing = computed(() => errorStatus(resource.error.value) === 404)
  return { selection, missing, ...resource }
}
