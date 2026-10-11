<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatRelativeDay } from '../../utils/format'
import {
  ALL_LOG_WINDOW,
  DEFAULT_LOG_WINDOW,
  hasIncident,
  LOG_WINDOWS,
  readLogsFilters,
  withLogsFilters,
} from '../../utils/logsQuery'
import {
  isPeriodWindow,
  readStoredWindow,
  sessionWindowStorage,
  storeWindow,
  windowStart,
} from '../../utils/periodWindow'

// The period of the request logs, in the page toolbar, drawn like the
// Overview's and the Routes page's (`PeriodWindow`): the exact start, then
// the four presets, so the toolbar's controls stand at the same place on the
// three pages. It writes `?window=`, which the request table reads (its rows
// and its tab counts). A link carrying `?window=` sets it. Without one, the
// page opens on the period of the tab, the last one named on any page of the
// module (`dms-api:window`), else the last 24 hours, which the table's route
// applies by itself. "All" (`?window=all`) is the filters bar's choice
// (`LogsFilters`): never the default, never kept for the other pages; nor is
// the period an incident's link brings to frame its range.
defineOptions({ inheritAttrs: false })

/** How often the start of the window shown beside the choice moves on. */
const RANGE_TICK_MS = 60_000

const { t } = useI18n()
const locale = useFormatLocale()
const route = useDmsRoute()
const router = useDmsRouter()
const { isLive: live } = usePageLive()

const items = computed(() =>
  LOG_WINDOWS.map((value) => ({
    label: t(`api.logs.period.short.${value}`),
    value,
  })),
)

const filters = computed(() => readLogsFilters(route.query))
const current = computed(() => filters.value.window ?? DEFAULT_LOG_WINDOW)

const selected = computed<string | number | undefined>({
  get: () => current.value,
  set: (value) => {
    const period = LOG_WINDOWS.find((entry) => entry === value)
    if (!period || period === current.value) return
    void router.push({
      query: withLogsFilters(route.query, { window: period }),
    })
  },
})

/** Keeps a period the URL names for the module, unless an incident framed it. */
function keep() {
  if (hasIncident(filters.value)) return
  storeWindow(sessionWindowStorage(), filters.value.window)
}

// A period the URL names (a choice, a link) is the module's from now on.
watch(() => filters.value.window, keep)

// The exact window, since the presets roll: "since yesterday 17:05". It
// depends on the clock, so only the browser writes it, and it holds still
// while the page is paused. An incident's range frames the rows instead: its
// chip says it.
const mounted = ref(false)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
function tick() {
  if (live.value) now.value = Date.now()
}
watch(live, tick)

const range = computed(() => {
  if (!mounted.value || hasIncident(filters.value)) return ''
  if (current.value === ALL_LOG_WINDOW) return t('api.logs.period.all_range')
  if (!isPeriodWindow(current.value)) return ''
  return t('api.logs.period.range', {
    from: formatRelativeDay(
      windowStart(current.value, now.value),
      locale.value,
      new Date(now.value),
    ),
  })
})

// None in the URL: the period of the tab comes back, through the URL like a
// choice, every other parameter kept. A link's incident frames the rows
// itself and is left alone.
onMounted(() => {
  mounted.value = true
  now.value = Date.now()
  timer = setInterval(tick, RANGE_TICK_MS)
  if (filters.value.window) {
    keep()
    return
  }
  if (hasIncident(filters.value)) return
  const kept = readStoredWindow(sessionWindowStorage())
  if (kept && kept !== DEFAULT_LOG_WINDOW)
    void router.replace({ query: { ...route.query, window: kept } })
})
onBeforeUnmount(() => clearInterval(timer))
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
      :aria-label="t('api.logs.period.aria')"
    />
  </div>
</template>
