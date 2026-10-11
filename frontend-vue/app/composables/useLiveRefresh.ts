import { onBeforeUnmount, onMounted, watch } from 'vue'

/** Realtime topic of the live feed (`LIVE_REQUESTS_TOPIC` on the server). */
export const LIVE_TOPIC = 'api:monitor:requests'

/**
 * Least time between two reads of one block on the feed: the request logs'
 * pace, the quickest of the live pages (`live: { maxRate }`).
 */
const MIN_GAP_MS = 5000

export interface LiveRefreshOptions {
  /**
   * Read again after this long without a message, while the page is live:
   * what judges time (the health, the last hour) moves without traffic.
   */
  idleMs?: number
}

/**
 * Keeps one of the console's own blocks in step with the page's Direct /
 * Pause state (the DMS `live` page option and its `LiveToggle`), as the DMS
 * blocks with a `realtimeTopic` are: in Direct, `refresh` runs on the live
 * feed, at most every 5 s with the last message of a burst kept; paused,
 * nothing is read and one read catches up on resume. A refresh the user asks
 * for (`refreshPageBlocks()`) reads at once, paused or not. Browser only.
 */
export function useLiveRefresh(
  refresh: () => void,
  options: LiveRefreshOptions = {},
) {
  const live = usePageLive()
  let last = Date.now()
  let missed = false
  let pending: ReturnType<typeof setTimeout> | undefined
  let idle: ReturnType<typeof setInterval> | undefined
  let stopPageRefresh: (() => void) | undefined

  function run() {
    clearTimeout(pending)
    pending = undefined
    missed = false
    last = Date.now()
    refresh()
  }

  function onMessage() {
    if (live.isPaused.value) {
      missed = true
      return
    }
    if (pending) return
    const wait = last + MIN_GAP_MS - Date.now()
    if (wait <= 0) run()
    else pending = setTimeout(run, wait)
  }

  useRealtimeTopic(LIVE_TOPIC, (event) => {
    if ('type' in event) onMessage()
  })

  watch(live.isPaused, (paused) => {
    if (paused) {
      if (pending) missed = true
      clearTimeout(pending)
      pending = undefined
    } else if (missed) run()
  })

  onMounted(() => {
    stopPageRefresh = onPageBlocksRefresh(run)
    const idleMs = options.idleMs
    if (idleMs)
      idle = setInterval(
        () => {
          if (!live.isPaused.value && Date.now() - last >= idleMs) run()
        },
        Math.min(idleMs, MIN_GAP_MS * 3),
      )
  })

  onBeforeUnmount(() => {
    stopPageRefresh?.()
    clearTimeout(pending)
    clearInterval(idle)
  })
}

/**
 * Calls `handler` each time the user asks the page's blocks to read their
 * data again (the DMS `refreshPageBlocks()`). Browser only.
 */
export function usePageBlocksRefresh(handler: () => void) {
  let stop: (() => void) | undefined
  onMounted(() => {
    stop = onPageBlocksRefresh(handler)
  })
  onBeforeUnmount(() => stop?.())
}
