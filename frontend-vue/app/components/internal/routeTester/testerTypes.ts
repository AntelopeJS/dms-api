import type { KeyValue } from '../../../utils/testerRequest'

export interface Row extends KeyValue {
  id: number
}

/** A row of the logs list, as far as finding a captured call goes. */
export interface CapturedRow {
  _id: string
  route?: string
  timestamp: string
  requestId?: string
}

export type CapturedState = 'idle' | 'loading' | 'found' | 'missing' | 'error'

/** A backend read of the tester's own flows (a replay, a capture lookup). */
export type ReadJson = <R>(url: string) => Promise<R>

/** What the tester keeps outside its reactive state: the route it is on, the call in flight. */
export interface TesterSession {
  activeRef: string | null
  inFlight: { controller: AbortController; ref: string } | null
  confirming: boolean
  unmounted: boolean
}

/** The props of `RouteTester`. */
export interface RouteTesterProps {
  fetchUrl: string
  queryKey?: string
}
