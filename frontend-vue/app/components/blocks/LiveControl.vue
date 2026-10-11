<script lang="ts">
/**
 * The control the shared live state belongs to: the page shown next may
 * mount its own before this one goes.
 */
let ownerOfState = 0
</script>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Ref,
} from 'vue'
import { formatAgo, formatCount } from '../../utils/format'
import {
  COUNT_MIN_GAP_MS,
  COUNT_POLL_MS,
  createPacer,
  hasPending,
  isLiveShortcut,
  latestTime,
  LIVE_BLOCKS_EVENT,
  LIVE_BLOCKS_FUNCTION,
  LIVE_COMMAND_EVENT,
  LIVE_REFRESH_EVENT,
  LIVE_STORAGE_KEY,
  LIVE_TOPIC,
  liveCadence,
  MAX_IDLE_MS,
  NO_PENDING,
  pendingFrom,
  reasonsKey,
  sinceQuery,
  sortedReasons,
  storedPaused,
  tableReasons,
  urlPaused,
  type LiveCommand,
  type LivePage,
  type PauseReason,
} from '../../utils/liveMode'
import {
  activeTab,
  findLiveTable,
  firstRowInView,
  highlightNewRows,
  newestRow,
  refreshTable,
  rowIds,
  snapshotTable,
  tableSearch,
  typingInTester,
} from '../../utils/liveTable'
import { readWindow } from '../../utils/periodWindow'
import { useRequestPanel } from '../../utils/requestDrawer'

// The page's Live / Pause control, the same on the Overview, the request
// logs and Routes, in the toolbar left of the period. Live by default: the
// capture publishes what it logged (at most every 1.5 s) and the page
// refreshes its blocks on it, no more often than its own pace — the console's
// blocks through `LIVE_REFRESH_EVENT`, the DMS ones (charts, cards, the
// request table) through `refreshPageBlocks()`. Without the realtime stream,
// it polls at the same pace. Paused, nothing moves: the control only counts
// what arrives, through the table's `/since` route, and on the Overview reads
// the API's verdict to tell a change the pause hides. Some actions pause by
// themselves and say why: a hidden tab or typing in the Tester the whole page;
// what the user does with the request table (a request open, a search, a
// sort, Load more, scrolled down) the table alone and its banner, while the
// health, the figures and the charts stay live. A pause lifts with its cause,
// unless the user paused by hand. The choice is kept per browser for the
// three pages; `?live=0` freezes a shared view.
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  page: LivePage
  sinceUrl: string
  defaultWindow?: string
  routeKey?: string
  /** The page's health route: paused, its verdict is read with the count. */
  healthUrl?: string
  /**
   * Ids of the DMS blocks around the request table (`src/pages/live.ts`):
   * read again on their own while the table holds.
   */
  liveBlocks?: string[]
  pageId?: string
  componentId?: string
}>()

const SORT_CHANGE_EVENT = 'DmsComponent.TableView.SortChange'
const HEARTBEAT_MS = 1000
/** Below this, the page reads as "updated just now". */
const JUST_NOW_SECONDS = 2

const REASON_KEYS: Record<PauseReason, string> = {
  hidden: 'hidden',
  panel: 'panel',
  tester: 'tester',
  search: 'search',
  sort: 'sort',
  loadMore: 'load_more',
  scroll: 'scroll',
}

const { t } = useI18n()
const locale = useFormatLocale()
const route = useDmsRoute()
const panel = useRequestPanel()
const realtime = useUserRealtime()
const { $authFetch } = useAuthFetch()
const { state, mode, reason, live, tableMode, tableReason, verdictChange } =
  useLiveMode()
const { registerFunction } = useDefinedFunctions()

/** The page's request table, when it shows rows. */
function liveTable() {
  const options = state.value.table
  return options ? findLiveTable(options) : null
}

const cadence = computed(() =>
  liveCadence(props.page, readWindow(route.query) ?? props.defaultWindow),
)

// --- why the page pauses by itself ---

const hidden = ref(false)
const testerTyping = ref(false)
const tableBlockers = ref<PauseReason[]>([])
const scrolledDown = ref(false)

const reasons = computed(() =>
  sortedReasons([
    ...(hidden.value ? (['hidden'] as const) : []),
    ...(testerTyping.value ? (['tester'] as const) : []),
  ]),
)

const heldReasons = computed(() =>
  sortedReasons([
    ...(panel.value.id ? (['panel'] as const) : []),
    ...tableBlockers.value,
    ...(scrolledDown.value ? (['scroll'] as const) : []),
  ]),
)

/** Live, but the request table holds: it takes no row in. */
const tableFrozen = computed(() => tableMode.value !== 'live')

// --- what the screen shows, and what came after ---

/** The newest request known when the screen was last brought up to date. */
let baseline: string | null = null
/** The newest request the feed told of. */
let lastFeedAt: string | null = null
/** The server's clock, from the last count. */
let serverNow: string | null = null
let lastCountAt = 0
/** Bumped when the screen catches up: a count still running is stale. */
let generation = 0
let stopHighlight: (() => void) | null = null

function markRefreshed() {
  state.value.lastRefreshAt = Date.now()
}

/** The screen shows everything up to now: nothing is pending. */
function caughtUp() {
  generation += 1
  baseline = latestTime([lastFeedAt, serverNow]) ?? new Date().toISOString()
  state.value.pending = { ...NO_PENDING }
  state.value.latestVerdict = null
}

function refreshCustom() {
  window.dispatchEvent(new CustomEvent(LIVE_REFRESH_EVENT))
  markRefreshed()
}

let blocksTick = 0

/**
 * The DMS blocks around a holding table read again, the table left as it
 * is: through their watch (`LIVE_BLOCKS_EVENT`), since the page refresh of
 * the DMS reaches every block.
 */
function refreshAroundTable() {
  blocksTick += 1
  for (const component of props.liveBlocks ?? []) {
    window.dispatchEvent(
      new CustomEvent(LIVE_BLOCKS_EVENT, {
        detail: { component, data: blocksTick },
      }),
    )
  }
}

// A watched event moves the block's state: its data is read again.
registerFunction(
  LIVE_BLOCKS_FUNCTION,
  (
    _action: unknown,
    detail: { data?: unknown } | undefined,
    blockState: Ref<Record<string, unknown>>,
  ) => {
    blockState.value = { ...blockState.value, live: detail?.data }
  },
)

/** The DMS blocks read again, the request table among them unless it holds. */
function refreshBlocks(force = false) {
  const table = liveTable()
  if (!force && table && tableFrozen.value) {
    refreshAroundTable()
    countPacer.request()
    markRefreshed()
    return
  }
  const before = rowIds(table)
  refreshPageBlocks()
  if (table) {
    stopHighlight?.()
    stopHighlight = highlightNewRows(table, before)
  }
  caughtUp()
  markRefreshed()
}

async function readPending() {
  lastCountAt = Date.now()
  const asked = generation
  const table = liveTable()
  const after = latestTime([table ? newestRow(table) : null, baseline])
  if (!after) return
  const query = sinceQuery({
    page: props.page,
    after,
    query: route.query,
    routeKey: props.routeKey,
    tab: table ? activeTab(table) : null,
    search: tableSearch(table),
  })
  try {
    const answer = await $authFetch<Record<string, unknown>>(
      `${props.sinceUrl}?${query}`,
    )
    if (typeof answer.now === 'string') serverNow = answer.now
    if (asked !== generation) return
    if (mode.value !== 'live' || tableFrozen.value)
      state.value.pending = pendingFrom(answer)
  } catch {
    // The count waits for the next message or poll.
  }
}

/** Paused, the API's verdict now: the control tells it when it changed. */
async function readVerdict() {
  if (!props.healthUrl || mode.value === 'live') return
  const asked = generation
  try {
    const health = await $authFetch<{ verdict?: unknown }>(props.healthUrl)
    if (asked !== generation) return
    if (typeof health.verdict === 'string')
      state.value.latestVerdict = health.verdict
  } catch {
    // Read again with the next count.
  }
}

const customPacer = createPacer(() => cadence.value.custom, refreshCustom)
const blocksPacer = createPacer(
  () => cadence.value.blocks,
  () => refreshBlocks(),
)
const countPacer = createPacer(
  () => COUNT_MIN_GAP_MS,
  () => {
    void readPending()
    void readVerdict()
  },
)

/** A message of the feed, or a poll standing in for one. */
function onFeed() {
  if (hidden.value) return
  if (mode.value !== 'live') {
    countPacer.request()
    return
  }
  customPacer.request()
  blocksPacer.request()
}

/**
 * The DMS blocks read again now, the table with them whatever holds it: the
 * page's next refresh, its pace counted from now (a message right after
 * would read them all a second time).
 */
function refreshBlocksNow(force = false) {
  blocksPacer.cancel()
  blocksPacer.touch()
  refreshBlocks(force)
}

/** Everything at once: on resume, back to the tab, or a Refresh. */
function refreshAll(force = false) {
  customPacer.force()
  refreshBlocksNow(force)
}

/**
 * The request table alone reads its rows again, by its own Refresh, what it
 * brings highlighted; `scroll`: brought back to its top (Show). False when
 * it draws no Refresh (a `compact` DMS table, on the Overview and Routes):
 * the DMS offers no other way to read one table again, its page refresh
 * reads every block of the page.
 */
function refreshTableAlone(scroll: boolean): boolean {
  const table = liveTable()
  const before = rowIds(table)
  if (!table || !refreshTable(table)) return false
  stopHighlight?.()
  stopHighlight = highlightNewRows(table, before)
  if (scroll && table.followScroll)
    table.card.scrollIntoView({ block: 'start' })
  caughtUp()
  return true
}

/**
 * Show: the table's new rows, now. A table without a Refresh of its own
 * reads them with the page's blocks, which counts as the page's next
 * refresh.
 */
function showNewRows() {
  if (!refreshTableAlone(true)) refreshBlocksNow(true)
}

/**
 * Asked by "Back to live": the table's next release reads its rows at once,
 * even without a Refresh of its own.
 */
let catchUpOnRelease = false

/**
 * The table no longer holds (the panel closed, the search cleared, back at
 * the top) while the page is live: it alone reads its rows again, the rest
 * of the page untouched. A table without a Refresh of its own catches up
 * with the page's next refresh, at its pace, as it does live: reading it
 * now would read every block of the page again.
 */
function releaseTable() {
  const now = catchUpOnRelease
  catchUpOnRelease = false
  if (refreshTableAlone(false)) return
  if (now) refreshBlocksNow()
  else blocksPacer.request()
}

useRealtimeTopic(LIVE_TOPIC, (event) => {
  if (!('type' in event)) return
  const last = event.payload?.lastTimestamp
  if (typeof last === 'string') lastFeedAt = latestTime([lastFeedAt, last])
  onFeed()
})

// --- the page as the user handles it ---

/**
 * The rows the user took back to live after Load more: the table follows
 * again with them, until more are loaded or it is back to its first page.
 */
let followedRows = 0

function inspectTable() {
  const table = liveTable()
  const snapshot = table ? snapshotTable(table) : null
  if (!snapshot || snapshot.rows <= snapshot.pageSize) followedRows = 0
  const blockers = tableReasons(snapshot, followedRows)
  if (blockers.join() !== tableBlockers.value.join())
    tableBlockers.value = blockers
  scrolledDown.value = !!table && table.followScroll && !firstRowInView(table)
}

/**
 * "Back to live" (or Show) on a table held by Load more: it follows again
 * with the rows it shows, newest first, read at once.
 */
function followAgain() {
  const table = liveTable()
  if (!table) return
  followedRows = snapshotTable(table).rows
  catchUpOnRelease = true
  inspectTable()
  // Held for another reason still: it waits for that one.
  if (heldReasons.value.length > 0) catchUpOnRelease = false
}

const now = ref(Date.now())

function beat() {
  now.value = Date.now()
  if (document.visibilityState === 'hidden') return
  // Also read here: a window without the focus sends no focus events.
  testerTyping.value = typingInTester(document.activeElement)
  inspectTable()
  state.value.connected = !!realtime.sessionId.value
  const idle = now.value - (state.value.lastRefreshAt ?? 0)
  if (mode.value === 'live') {
    // No stream: poll at the page's pace. A stream: still refresh after a
    // quiet minute, the health judges time too.
    if (
      (!state.value.connected && idle >= cadence.value.custom) ||
      idle >= MAX_IDLE_MS
    )
      onFeed()
    if (tableFrozen.value && now.value - lastCountAt >= COUNT_POLL_MS)
      countPacer.request()
  } else if (
    reason.value !== 'hidden' &&
    now.value - lastCountAt >= COUNT_POLL_MS
  ) {
    countPacer.request()
  }
}

function persist(paused: boolean) {
  try {
    window.localStorage.setItem(LIVE_STORAGE_KEY, paused ? 'paused' : 'live')
  } catch {
    // Storage refused (private window): the choice holds for this page.
  }
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(LIVE_STORAGE_KEY)
  } catch {
    return null
  }
}

/** Drops `?live=0` without a visit: the view is no longer frozen. */
function unfreezeUrl() {
  if (!urlPaused(route.query)) return
  const url = new URL(window.location.href)
  url.searchParams.delete('live')
  window.history.replaceState(window.history.state, '', url.href)
}

function pause() {
  state.value.override = null
  if (state.value.userPaused) return
  state.value.userPaused = true
  persist(true)
}

function goLive() {
  const current = state.value
  if (current.userPaused) {
    current.userPaused = false
    persist(false)
    unfreezeUrl()
  }
  // Live over an automatic pause: kept until its causes change.
  if (current.reasons.length > 0 && !current.reasons.includes('hidden'))
    current.override = reasonsKey(current.reasons)
}

function toggle() {
  if (mode.value === 'live') pause()
  else goLive()
}

function onKey(event: KeyboardEvent) {
  if (event.defaultPrevented || !isLiveShortcut(event)) return
  event.preventDefault()
  toggle()
}

function onCommand(event: Event) {
  const command = (event as CustomEvent<LiveCommand>).detail
  if (command === 'refresh') refreshAll(true)
  // Show over more rows loaded: the table takes the new ones in, and keeps
  // following them.
  else if (command === 'show' && tableReason.value === 'loadMore') followAgain()
  else if (command === 'show') showNewRows()
}

function onVisibility() {
  hidden.value = document.visibilityState === 'hidden'
  if (!hidden.value) return
  customPacer.cancel()
  blocksPacer.cancel()
  countPacer.cancel()
}

function onFocusChange() {
  // After the focus moved: `focusout` fires while it is still leaving.
  setTimeout(() => {
    testerTyping.value = typingInTester(document.activeElement)
  }, 0)
}

function onSortChange() {
  void nextTick(inspectTable)
}

// The automatic pause lifted by the user stays lifted for its causes only.
watch(reasons, (next) => {
  if (!state.value.ready) return
  state.value.reasons = next
  const key = reasonsKey(next)
  if (state.value.override !== null && state.value.override !== key)
    state.value.override = null
})

watch(heldReasons, (next) => {
  if (state.value.ready) state.value.tableReasons = next
})

// The table alone: held, it counts what it misses; free again while the
// page is live, it catches up (`releaseTable`).
watch(
  () => heldReasons.value.length > 0,
  (holds) => {
    if (!state.value.ready || mode.value !== 'live') return
    if (holds) countPacer.request()
    else releaseTable()
  },
)

watch(mode, (next, previous) => {
  if (!state.value.ready || next === previous) return
  if (next === 'live') {
    // Resumed (by hand, or its cause gone): everything at once, the health
    // block's verdict with it; a count or a verdict still on its way is stale.
    generation += 1
    state.value.latestVerdict = null
    countPacer.cancel()
    refreshAll()
    return
  }
  customPacer.cancel()
  blocksPacer.cancel()
  if (reason.value !== 'hidden') countPacer.request()
})

let owner = 0
let heartbeat: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  owner = Date.now() + Math.random()
  const current = state.value
  current.reasons = []
  current.override = null
  current.pending = { ...NO_PENDING }
  current.tableReasons = []
  current.latestVerdict = null
  current.lastRefreshAt = Date.now()
  current.userPaused = urlPaused(route.query) || storedPaused(readStored())
  hidden.value = document.visibilityState === 'hidden'
  baseline = new Date().toISOString()
  current.ready = true
  ownerOfState = owner
  current.reasons = reasons.value
  current.tableReasons = heldReasons.value

  window.addEventListener('keydown', onKey)
  window.addEventListener(LIVE_COMMAND_EVENT, onCommand)
  window.addEventListener(SORT_CHANGE_EVENT, onSortChange)
  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('focusin', onFocusChange)
  document.addEventListener('focusout', onFocusChange)
  // The page was just loaded: the first message waits for the page's pace.
  customPacer.touch()
  blocksPacer.touch()
  heartbeat = setInterval(beat, HEARTBEAT_MS)
  beat()
  if (mode.value !== 'live') countPacer.request()
})

onBeforeUnmount(() => {
  if (ownerOfState === owner) state.value.ready = false
  clearInterval(heartbeat)
  customPacer.cancel()
  blocksPacer.cancel()
  countPacer.cancel()
  stopHighlight?.()
  window.removeEventListener('keydown', onKey)
  window.removeEventListener(LIVE_COMMAND_EVENT, onCommand)
  window.removeEventListener(SORT_CHANGE_EVENT, onSortChange)
  document.removeEventListener('visibilitychange', onVisibility)
  document.removeEventListener('focusin', onFocusChange)
  document.removeEventListener('focusout', onFocusChange)
})

// --- what it says ---

const count = (value: number) => formatCount(value, locale.value)

const updated = computed(() => {
  const at = state.value.lastRefreshAt
  if (!state.value.ready || !at) return ''
  const ago = formatAgo(at, now.value)
  if (!ago || (ago.unit === 's' && ago.amount < JUST_NOW_SECONDS))
    return t('api.live_mode.updated_now')
  return t('api.live_mode.updated', {
    ago: t(`api.common.ago_${ago.unit}`, { amount: count(ago.amount) }),
  })
})

const pausedLabel = computed(() =>
  reason.value
    ? t('api.live_mode.paused_because', {
        reason: t(`api.live_mode.reasons.${REASON_KEYS[reason.value]}`),
      })
    : t('api.live_mode.paused'),
)

/** Live, but the request table holds by itself: why, beside the control. */
const tableHeldLabel = computed(() =>
  live.value && state.value.ready && tableFrozen.value && tableReason.value
    ? t('api.live_mode.table_held', {
        reason: t(`api.live_mode.reasons.${REASON_KEYS[tableReason.value]}`),
      })
    : '',
)

const pending = computed(() => state.value.pending)
const newRequests = computed(() =>
  t(
    'api.live_mode.new_requests',
    { count: count(pending.value.count) },
    pending.value.count,
  ),
)
const serverErrors = computed(() =>
  t('api.live_mode.server_errors', {
    count: count(pending.value.serverErrors),
  }),
)
const verdictName = (verdict: string) => t(`api.health.verdict.${verdict}`)
const verdictChanged = computed(() =>
  verdictChange.value
    ? t('api.live_mode.verdict.changed', {
        from: verdictName(verdictChange.value.from),
        to: verdictName(verdictChange.value.to),
      })
    : '',
)

const fromTester = computed(() =>
  t(
    'api.live_mode.tester',
    { count: count(pending.value.tester) },
    pending.value.tester,
  ),
)
</script>

<template>
  <!-- Never squeezed below its content: in a narrow toolbar it moves to the
       next line (see `PageToolbar`), and its own parts wrap within it. -->
  <div class="flex max-w-full shrink-0 flex-wrap items-center gap-x-2 gap-y-1">
    <UTooltip :text="t('api.live_mode.hint')" :kbds="['L']">
      <div
        role="group"
        :aria-label="t('api.live_mode.label')"
        class="border-default bg-default inline-flex shrink-0 items-center gap-0.5 rounded-md border p-0.5"
      >
        <button
          type="button"
          :aria-pressed="live"
          class="focus-visible:outline-primary flex items-center gap-1.5 rounded-[5px] px-2 py-1 font-mono text-[11.5px] font-medium transition-colors focus-visible:outline-2"
          :class="
            live
              ? 'bg-success/10 text-success'
              : 'text-muted hover:text-default hover:bg-elevated'
          "
          @click="goLive"
        >
          <span
            class="size-2 rounded-full"
            :class="
              live
                ? 'bg-success motion-safe:animate-pulse'
                : 'bg-(--ui-border-accented)'
            "
          />
          {{ t('api.live_mode.live') }}
        </button>
        <button
          type="button"
          :aria-pressed="!live"
          class="focus-visible:outline-primary flex items-center gap-1.5 rounded-[5px] px-2 py-1 font-mono text-[11.5px] font-medium transition-colors focus-visible:outline-2"
          :class="
            live
              ? 'text-muted hover:text-default hover:bg-elevated'
              : 'bg-elevated text-highlighted'
          "
          @click="pause"
        >
          <UIcon name="i-ph-pause-fill" class="size-3" />
          {{ t('api.live_mode.pause') }}
        </button>
      </div>
    </UTooltip>
    <span
      v-if="live && updated"
      class="text-dimmed hidden whitespace-nowrap font-mono text-[11.5px] tabular-nums md:inline"
    >
      {{ updated }}
      <template v-if="!state.connected">
        · {{ t('api.live_mode.polling') }}
      </template>
    </span>
    <span
      aria-live="polite"
      class="text-muted hidden min-w-0 truncate font-mono text-[11.5px] sm:inline"
    >
      <template v-if="!live">
        {{ pausedLabel }}
        <template v-if="hasPending(pending)">
          · {{ newRequests }}
          <span v-if="pending.serverErrors > 0" class="text-error">
            · {{ serverErrors }}
          </span>
          <template v-if="pending.tester > 0">· {{ fromTester }}</template>
        </template>
      </template>
      <template v-else-if="tableHeldLabel">{{ tableHeldLabel }}</template>
    </span>
    <!-- A verdict changed during the pause: the one thing not to miss, on a
         phone too, with the way back to Live. -->
    <UButton
      v-if="verdictChanged"
      size="xs"
      color="error"
      variant="soft"
      icon="i-ph-warning-circle-fill"
      :label="`${verdictChanged} · ${t('api.live_mode.resume')}`"
      @click="goLive"
    />
    <!-- On a phone, the Live button above does the same. -->
    <UButton
      v-else-if="mode === 'paused'"
      size="xs"
      color="neutral"
      variant="soft"
      icon="i-ph-play-fill"
      class="max-sm:hidden"
      :label="t('api.live_mode.resume')"
      @click="goLive"
    />
    <!-- More rows loaded hold the table until the user takes it back. -->
    <UButton
      v-else-if="tableReason === 'loadMore'"
      size="xs"
      color="neutral"
      variant="soft"
      icon="i-ph-arrow-line-up"
      :label="t('api.live_mode.back_to_live')"
      @click="followAgain"
    />
  </div>
</template>

<style>
/* A row the live mode took in: tinted a moment, then as the others. */
@keyframes dms-api-live-new {
  from {
    background-color: color-mix(in oklab, var(--ui-primary) 16%, transparent);
  }
  to {
    background-color: transparent;
  }
}
tr.dms-api-live-new > td {
  animation: dms-api-live-new 1.5s ease-out;
}
@media (prefers-reduced-motion: reduce) {
  tr.dms-api-live-new > td {
    animation: none;
  }
}
</style>
