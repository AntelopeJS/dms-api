import { computed, onBeforeUnmount, onMounted } from 'vue'
import {
  liveStatus,
  NO_PENDING,
  verdictChange,
  type PauseReason,
  type PendingCount,
} from '../utils/liveMode'

/**
 * The page's live mode, shared by its blocks. The page's `LiveControl` owns
 * it and its timers; the other blocks read it (the live graph says whether it
 * moves, the period stops sliding while paused).
 */
export interface LiveState {
  /** Set once the control read the user's choice: until then, Live. */
  ready: boolean
  userPaused: boolean
  /** Why the page paused by itself (hidden tab, Tester). */
  reasons: PauseReason[]
  /** The automatic pause the user lifted (see `LiveInputs.override`). */
  override: string | null
  /** When the page last refreshed, live or by hand. */
  lastRefreshAt: number | null
  /** What arrived since the screen was last brought up to date. */
  pending: PendingCount
  /** The realtime stream is up: without it, the control polls. */
  connected: boolean
  /** The API verdict when the page paused (the Overview). */
  verdict: string | null
  /** The verdict read while paused, to tell a change the pause hides. */
  latestVerdict: string | null
}

function initialState(): LiveState {
  return {
    ready: false,
    userPaused: false,
    reasons: [],
    override: null,
    lastRefreshAt: null,
    pending: { ...NO_PENDING },
    connected: true,
    verdict: null,
    latestVerdict: null,
  }
}

export function useLiveState() {
  return useDmsState<LiveState>('dms-api:live', initialState)
}

/** Where the page stands: live, paused, or paused by itself and why. */
export function useLiveMode() {
  const state = useLiveState()
  const status = computed(() => liveStatus(state.value))
  return {
    state,
    mode: computed(() => status.value.mode),
    reason: computed(() => status.value.reason),
    /** Moving: Live before the control has read the user's choice. */
    live: computed(() => !state.value.ready || status.value.mode === 'live'),
    /** Paused, the API verdict changed since the pause. */
    verdictChange: computed(() =>
      status.value.mode === 'live'
        ? null
        : verdictChange(state.value.verdict, state.value.latestVerdict),
    ),
  }
}

/**
 * Calls `handler` each time the page asks its blocks to read their data
 * again (the DMS `refreshPageBlocks()`, which the live mode calls): the
 * console's own blocks refresh with the DMS ones. Browser only.
 */
export function usePageBlocksRefresh(handler: () => void) {
  let stop: (() => void) | undefined
  onMounted(() => {
    stop = onPageBlocksRefresh(handler)
  })
  onBeforeUnmount(() => stop?.())
}
