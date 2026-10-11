import { computed, onBeforeUnmount, onMounted } from 'vue'
import {
  LIVE_COMMAND_EVENT,
  LIVE_REFRESH_EVENT,
  liveStatus,
  NO_PENDING,
  tableStatus,
  verdictChange,
  type LiveCommand,
  type PauseReason,
  type PendingCount,
} from '../utils/liveMode'
import type { LiveTableOptions } from '../utils/liveTable'

/**
 * The page's live mode, shared by its blocks. The page's `LiveControl` owns
 * it and its timers; the other blocks read it (the live graph says whether it
 * moves) and refresh when told (`useLiveRefresh`). Two scopes: the page, and
 * its request table, which may hold alone while the rest stays live.
 */
export interface LiveState {
  /** Set once the control read the user's choice: until then, Live. */
  ready: boolean
  userPaused: boolean
  /** Why the whole page paused by itself (hidden tab, Tester). */
  reasons: PauseReason[]
  /**
   * Why the request table holds by itself (panel, search, sort, Load more,
   * scroll): only the table and its banner stop.
   */
  tableReasons: PauseReason[]
  /** The automatic pause the user lifted (see `LiveInputs.override`). */
  override: string | null
  /** When the page last refreshed, live or by hand. */
  lastRefreshAt: number | null
  /** What arrived since the rows on screen, while they do not move. */
  pending: PendingCount
  /** The realtime stream is up: without it, the control polls. */
  connected: boolean
  /** The page's request table, as its `LiveBanner` describes it. */
  table: LiveTableOptions | null
  /** The API verdict on screen (the Overview's health block). */
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
    tableReasons: [],
    connected: true,
    table: null,
    verdict: null,
    latestVerdict: null,
  }
}

export function useLiveState() {
  return useDmsState<LiveState>('dms-api:live', initialState)
}

/**
 * Where the page stands: live, paused, or paused by itself and why; and
 * where its request table stands, which may hold alone.
 */
export function useLiveMode() {
  const state = useLiveState()
  const status = computed(() => liveStatus(state.value))
  const table = computed(() =>
    tableStatus(status.value, state.value.tableReasons),
  )
  return {
    state,
    mode: computed(() => status.value.mode),
    reason: computed(() => status.value.reason),
    /** Moving: Live before the control has read the user's choice. */
    live: computed(() => !state.value.ready || status.value.mode === 'live'),
    /** The request table's own status: `auto` with its reason when held. */
    tableMode: computed(() => table.value.mode),
    tableReason: computed(() => table.value.reason),
    /** The table takes new rows in: Live before the control is ready. */
    tableLive: computed(
      () => !state.value.ready || table.value.mode === 'live',
    ),
    /** Paused, the API verdict changed since the one on screen. */
    verdictChange: computed(() =>
      status.value.mode === 'live'
        ? null
        : verdictChange(state.value.verdict, state.value.latestVerdict),
    ),
  }
}

/**
 * Calls `handler` each time the live page refreshes its blocks (never while
 * paused). Browser only.
 */
export function useLiveRefresh(handler: () => void) {
  const listener = () => handler()
  onMounted(() => window.addEventListener(LIVE_REFRESH_EVENT, listener))
  onBeforeUnmount(() =>
    window.removeEventListener(LIVE_REFRESH_EVENT, listener),
  )
}

/** Asks the page's control to refresh the page, or show the new rows. */
export function sendLiveCommand(command: LiveCommand) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<LiveCommand>(LIVE_COMMAND_EVENT, { detail: command }),
  )
}
