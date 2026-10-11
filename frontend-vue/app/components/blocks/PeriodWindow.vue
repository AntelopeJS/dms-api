<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { formatRelativeDay } from '../../utils/format'
import {
  PERIOD_WINDOWS,
  type PeriodWindow as Preset,
  queryWithWindow,
  readStoredWindow,
  readWindow,
  sessionWindowStorage,
  storeWindow,
  WINDOW_PRESETS,
  windowStart,
} from '../../utils/periodWindow'

// The period of a page's cards, kept in its URL: `?window=24h` sets it on
// arrival, and a choice writes it back over the current entry through the
// DMS router, every other parameter kept, so the router's own state holds it
// too: a later navigation of the page (a tab, the request panel) keeps it, and
// a reload or a shared link shows the same period. The DMS `PeriodSelector`
// keeps its period in memory only, so this block drives the cards' period
// scope (`scope`, their `periodScope`) itself, always against the previous
// period of the same length: the "vs" figure of each card. Any page holding
// period-scoped cards can use it. The period in force is kept for the
// module's other pages (`dms-api:window`, for the tab): opened without
// `?window=`, a page takes back the last one, written into its URL.
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{ scope: string; defaultWindow?: Preset }>(),
  { defaultWindow: '24h' },
)

/** How often the start of the window shown beside the choice moves on. */
const RANGE_TICK_MS = 60_000

const { t } = useI18n()
const locale = useFormatLocale()
const route = useDmsRoute()
const router = useDmsRouter()
const { live } = useLiveMode()

const current = computed<Preset>(
  () => readWindow(route.query) ?? props.defaultWindow,
)

const period = usePeriod({
  defaultPreset: WINDOW_PRESETS[current.value],
  defaultComparison: 'previous-period',
  presets: PERIOD_WINDOWS.map((value) => WINDOW_PRESETS[value]),
  comparisons: ['previous-period'],
})
// Paused, the cards keep their period: the DMS period's clock moves a
// rolling preset every minute, and each move would read every card again.
// A period chosen while paused still applies; Live takes the clock back.
// TODO: drop once the DMS holds the period itself with `usePageLive()`.
const held = shallowRef(period.state.value)
watch([() => period.state.value, live], ([state, isLive], [previous]) => {
  if (isLive || state.preset !== previous.preset) held.value = state
})
onBeforeUnmount(
  registerPeriodScope(
    props.scope,
    computed(() => held.value),
  ),
)

// The URL leads: a choice, Back or a link carrying `?window=` all move the
// cards' period.
watch(current, (value) => period.setPreset(WINDOW_PRESETS[value]))

const items = computed(() =>
  PERIOD_WINDOWS.map((value) => ({
    label: t(`api.overview.window.${value}`),
    value,
  })),
)

const selected = computed<string | number | undefined>({
  get: () => current.value,
  set: (value) => {
    const next = PERIOD_WINDOWS.find((entry) => entry === value)
    if (!next || next === current.value) return
    void router.replace({ query: queryWithWindow(route.query, next) })
  },
})

// The exact window, since the presets roll: "since yesterday 17:05". It
// depends on the clock, so only the browser writes it, and it holds still
// while the page is paused, like the cards.
const mounted = ref(false)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
function tick() {
  if (live.value) now.value = Date.now()
}
watch(live, tick)

// A period the URL names (a choice, a link) is the module's from now on.
watch(
  () => readWindow(route.query),
  (named) => storeWindow(sessionWindowStorage(), named),
)
onMounted(() => {
  mounted.value = true
  now.value = Date.now()
  timer = setInterval(tick, RANGE_TICK_MS)

  // None in the URL: the last period of the tab comes back, through the URL
  // like a choice.
  const named = readWindow(route.query)
  if (named) {
    storeWindow(sessionWindowStorage(), named)
    return
  }
  const kept = readStoredWindow(sessionWindowStorage())
  if (kept && kept !== props.defaultWindow)
    void router.replace({ query: queryWithWindow(route.query, kept) })
})
onBeforeUnmount(() => clearInterval(timer))

const range = computed(() =>
  mounted.value
    ? t('api.overview.window.range', {
        from: formatRelativeDay(
          windowStart(current.value, now.value),
          locale.value,
          new Date(now.value),
        ),
      })
    : '',
)
</script>

<template>
  <div class="flex shrink-0 items-center gap-2">
    <span
      v-if="range"
      class="text-dimmed hidden whitespace-nowrap font-mono text-[11.5px] tabular-nums lg:inline"
    >
      {{ range }}
    </span>
    <DmsSegmented
      v-model="selected"
      :items="items"
      size="sm"
      variant="mono"
      :aria-label="t('api.overview.window.aria')"
    />
  </div>
</template>
