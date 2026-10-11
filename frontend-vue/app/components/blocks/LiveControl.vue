<script lang="ts">
/**
 * The control the shared live state belongs to: the page shown next may
 * mount its own before this one goes.
 */
let ownerOfState = 0
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatAgo, formatCount } from '../../utils/format'
import {
  COUNT_MIN_GAP_MS,
  COUNT_POLL_MS,
  createPacer,
  hasPending,
  isLiveShortcut,
  latestTime,
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
  urlPaused,
  type LivePage,
} from '../../utils/liveMode'
import { readWindow } from '../../utils/periodWindow'

// The page's Live / Pause control, the same on the Overview, the request
// logs and Routes, in the toolbar left of the period. Live by default: the
// capture publishes what it logged (at most every 1.5 s) and the control asks
// every block of the page to read its data again (`refreshPageBlocks()`, the
// DMS page refresh), no more often than the page's pace. Without the realtime
// stream, it polls at the same pace. Paused, nothing moves: the control only
// counts what arrives, through the page's `/since` route, and on the Overview
// reads the API's verdict to tell a change the pause hides. A hidden tab or
// typing in the Tester pause the page by themselves and say why; the pause
// lifts with its cause, unless the user paused by hand. The choice is kept
// per browser for the three pages; `?live=0` freezes a shared view.
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  page: LivePage
  sinceUrl: string
  defaultWindow?: string
  routeKey?: string
  /** The API's verdict (`{ verdict }`): paused, read with the count. */
  verdictUrl?: string
}>()

/** How often "Updated 12 s ago" moves on. */
const CLOCK_TICK_MS = 5000
/** Below this, the page reads as "updated just now". */
const JUST_NOW_SECONDS = 10
/** Where the Tester's fields are: typing there pauses the page. */
const TESTER_SELECTOR = '[data-dms-api-tester]'

const { t } = useI18n()
const locale = useFormatLocale()
const route = useDmsRoute()
const router = useDmsRouter()
const realtime = useUserRealtime()
const { $authFetch } = useAuthFetch()
const { state, mode, reason, live, verdictChange } = useLiveMode()

const cadence = computed(() =>
  liveCadence(props.page, readWindow(route.query) ?? props.defaultWindow),
)

// --- why the page pauses by itself ---

const hidden = ref(false)
const testerTyping = ref(false)

const reasons = computed(() =>
  sortedReasons([
    ...(hidden.value ? (['hidden'] as const) : []),
    ...(testerTyping.value ? (['tester'] as const) : []),
  ]),
)

// --- what the screen shows, and what came after ---

/** When the screen was last brought up to date, by the server's clock. */
let baseline: string | null = null
/** The newest request the feed told of. */
let lastFeedAt: string | null = null
/** The server's clock, from the last count. */
let serverNow: string | null = null
/** Bumped when the screen catches up: a count still running is stale. */
let generation = 0

/** The screen shows everything up to now: nothing is pending. */
function caughtUp() {
  generation += 1
  baseline = latestTime([lastFeedAt, serverNow]) ?? new Date().toISOString()
  state.value.pending = { ...NO_PENDING }
  state.value.lastRefreshAt = Date.now()
}

/** Every block of the page reads its data again. */
function refreshPage() {
  refreshPageBlocks()
  caughtUp()
}

async function readPending() {
  const asked = generation
  if (!baseline) return
  const query = sinceQuery({
    page: props.page,
    after: baseline,
    query: route.query,
    routeKey: props.routeKey,
  })
  try {
    const answer = await $authFetch<Record<string, unknown>>(
      `${props.sinceUrl}?${query}`,
    )
    if (typeof answer.now === 'string') serverNow = answer.now
    if (asked !== generation || mode.value === 'live') return
    state.value.pending = pendingFrom(answer)
  } catch {
    // The count waits for the next message or poll.
  }
}

async function readVerdict(): Promise<string | null> {
  if (!props.verdictUrl) return null
  try {
    const health = await $authFetch<{ verdict?: unknown }>(props.verdictUrl)
    return typeof health.verdict === 'string' ? health.verdict : null
  } catch {
    return null
  }
}

/** Paused, the verdict now: the control tells it when it changed. */
async function readLatestVerdict() {
  const asked = generation
  const verdict = await readVerdict()
  if (asked === generation && mode.value !== 'live' && verdict)
    state.value.latestVerdict = verdict
}

const refreshPacer = createPacer(() => cadence.value, refreshPage)
const countPacer = createPacer(
  () => COUNT_MIN_GAP_MS,
  () => {
    void readPending()
    void readLatestVerdict()
  },
)

/** A message of the feed, or a poll standing in for one. */
function onFeed() {
  if (hidden.value) return
  if (mode.value === 'live') refreshPacer.request()
  else countPacer.request()
}

useRealtimeTopic(LIVE_TOPIC, (event) => {
  if (!('type' in event)) return
  const last = event.payload?.lastTimestamp
  if (typeof last === 'string') lastFeedAt = latestTime([lastFeedAt, last])
  onFeed()
})

// --- the clock: polls without a stream, counts while paused ---

const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined

function tick() {
  now.value = Date.now()
  if (hidden.value) return
  state.value.connected = !!realtime.sessionId.value
  const idle = now.value - (state.value.lastRefreshAt ?? 0)
  if (mode.value === 'live') {
    // No stream: poll at the page's pace. A stream: still refresh after a
    // quiet minute, the health judges time too.
    if (
      (!state.value.connected && idle >= cadence.value) ||
      idle >= MAX_IDLE_MS
    )
      refreshPacer.request()
  } else if (now.value - countPacer.last() >= COUNT_POLL_MS) {
    countPacer.request()
  }
}

// --- the user's choice ---

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

/** Drops `?live=0`: the view is no longer frozen. */
function unfreezeUrl() {
  if (!urlPaused(route.query)) return
  const { live: _live, ...query } = route.query
  void router.replace({ query })
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

/** Paused, the new requests shown now; the page stays paused. */
function showNow() {
  refreshPage()
  state.value.latestVerdict = null
  void readVerdict().then((verdict) => (state.value.verdict = verdict))
}

function onKey(event: KeyboardEvent) {
  if (event.defaultPrevented || !isLiveShortcut(event)) return
  event.preventDefault()
  if (mode.value === 'live') pause()
  else goLive()
}

function onVisibility() {
  hidden.value = document.visibilityState === 'hidden'
  if (!hidden.value) return
  refreshPacer.cancel()
  countPacer.cancel()
}

function inTester(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TESTER_SELECTOR) !== null
}

function onFocusIn(event: FocusEvent) {
  testerTyping.value = inTester(event.target)
}

function onFocusOut(event: FocusEvent) {
  testerTyping.value = inTester(event.relatedTarget)
}

// The automatic pause lifted by the user stays lifted for its causes only.
watch(reasons, (next) => {
  if (!state.value.ready) return
  state.value.reasons = next
  const key = reasonsKey(next)
  if (state.value.override !== null && state.value.override !== key)
    state.value.override = null
})

watch(mode, async (next, previous) => {
  if (!state.value.ready || next === previous) return
  if (next === 'live') {
    // Resumed (by hand, or its cause gone): everything at once; a count or a
    // verdict still on its way is stale.
    countPacer.cancel()
    state.value.latestVerdict = null
    refreshPacer.force()
    return
  }
  refreshPacer.cancel()
  // The verdict on screen, which a later one is compared with.
  state.value.verdict = await readVerdict()
  if (reason.value !== 'hidden') countPacer.request()
})

let owner = 0

onMounted(() => {
  owner = Date.now() + Math.random()
  const current = state.value
  current.reasons = []
  current.override = null
  current.pending = { ...NO_PENDING }
  current.verdict = null
  current.latestVerdict = null
  current.lastRefreshAt = Date.now()
  current.userPaused = urlPaused(route.query) || storedPaused(readStored())
  hidden.value = document.visibilityState === 'hidden'
  baseline = new Date().toISOString()
  current.ready = true
  ownerOfState = owner
  current.reasons = reasons.value

  window.addEventListener('keydown', onKey)
  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  // The page was just loaded: the first message waits for the page's pace.
  refreshPacer.touch()
  clock = setInterval(tick, CLOCK_TICK_MS)
  if (mode.value !== 'live') {
    void readVerdict().then((verdict) => (state.value.verdict = verdict))
    countPacer.request()
  }
})

onBeforeUnmount(() => {
  if (ownerOfState === owner) state.value.ready = false
  clearInterval(clock)
  refreshPacer.cancel()
  countPacer.cancel()
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('visibilitychange', onVisibility)
  document.removeEventListener('focusin', onFocusIn)
  document.removeEventListener('focusout', onFocusOut)
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
        reason: t(`api.live_mode.reasons.${reason.value}`),
      })
    : t('api.live_mode.paused'),
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
       next line, and its own parts wrap within it. -->
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
      v-if="!live"
      aria-live="polite"
      class="text-muted hidden min-w-0 truncate font-mono text-[11.5px] sm:inline"
    >
      {{ pausedLabel }}
      <template v-if="hasPending(pending)">
        · {{ newRequests }}
        <span v-if="pending.serverErrors > 0" class="text-error">
          · {{ serverErrors }}
        </span>
        <template v-if="pending.tester > 0">· {{ fromTester }}</template>
      </template>
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
    <template v-else-if="mode === 'paused'">
      <!-- Paused with new requests: shown once, the page staying paused. -->
      <UButton
        v-if="hasPending(pending)"
        size="xs"
        color="neutral"
        variant="soft"
        icon="i-ph-arrow-line-up"
        :label="t('api.live_mode.show')"
        @click="showNow"
      />
      <!-- On a phone, the Live button above does the same. -->
      <UButton
        size="xs"
        color="neutral"
        variant="soft"
        icon="i-ph-play-fill"
        class="max-sm:hidden"
        :label="t('api.live_mode.resume')"
        @click="goLive"
      />
    </template>
  </div>
</template>
