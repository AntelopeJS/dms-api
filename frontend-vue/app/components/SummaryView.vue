<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type {
  ActivityItem,
  HistoryPoint,
  MonitoringPayload,
  RouteAggregate,
  StatusBreakdown,
  SummaryPayload,
  WatchListItem,
} from '../composables/useApiIntrospection'
import ApiMethodBadge from './internal/ApiMethodBadge.vue'
import ApiStatusBadge from './internal/ApiStatusBadge.vue'
import PeriodSelect from './internal/PeriodSelect.vue'
import StatusBreakdownBars from './internal/StatusBreakdownBars.vue'
import StatusDonut from './internal/StatusDonut.vue'
import { STATUS_CLASSES } from '../utils/statusClass'

// Overview page (apiv2-overview): beta banner + 6 stat-cards +
// traffic area chart + status donut + needs-attention + slowest routes +
// recent requests table + activity feed. Composed entirely from the DMS
// primitives (DmsKpiCard / DmsChart / DmsActivityItem / DmsCard / DmsBanner)
// so the theme is inherited, not ported.
const {
  getSummary,
  getSummaryHistory,
  getStatusBreakdown,
  getWatchList,
  getActivity,
  getMonitoring,
} = useApiIntrospection()

const { t } = useI18n()
const route = useDmsRoute()
const router = useDmsRouter()

// Traffic-chart accents, pinned to the DMS reference: cyan requests against
// red errors. The status-class palette lives in STATUS_CLASSES — this chart
// merges the two error classes, so it is a different pair of colours.
const C_REQUESTS = '#4dd9e6'
const C_ERRORS = '#f87171'

// Window from the period filter shared with the Routes and Logs pages; null
// until <PeriodSelect> resolves one, which is what holds the fetches below.
const period = ref<string | null>(null)

const uriFilter = ref('')
const breakdownView = ref<'bars' | 'donut'>('bars')

const summary = ref<SummaryPayload | null>(null)
const history = ref<HistoryPoint[]>([])
const breakdown = ref<StatusBreakdown | null>(null)
const watchList = ref<WatchListItem[]>([])
const activity = ref<ActivityItem[]>([])
const monitoring = ref<MonitoringPayload | null>(null)
const error = ref<string | null>(null)
const loading = ref(true)

function fail(e: unknown) {
  error.value = e instanceof Error ? e.message : String(e)
}

/**
 * The KPIs, the watch-list and the activity feed take no period, so they are
 * not held behind the retention round-trip <PeriodSelect> needs before it can
 * name a window — they go out on mount and land while it is still resolving.
 */
async function loadWindowless() {
  try {
    const [s, w, a] = await Promise.all([
      getSummary(),
      getWatchList(5),
      getActivity(),
    ])
    summary.value = s
    watchList.value = w
    activity.value = a
  } catch (e) {
    fail(e)
  }
}

async function loadForPeriod() {
  const window = period.value
  if (!window) return
  loading.value = true
  error.value = null
  try {
    const [hist, bd, mon] = await Promise.all([
      getSummaryHistory(window),
      getStatusBreakdown(window),
      getMonitoring({ period: window }),
    ])
    history.value = hist
    breakdown.value = bd
    monitoring.value = mon
  } catch (e) {
    fail(e)
  } finally {
    loading.value = false
  }
}

/** Refresh button: everything, whatever it depends on. */
async function load() {
  await Promise.all([loadWindowless(), loadForPeriod()])
}

onMounted(loadWindowless)

// The window owns the fetches that depend on it: the first runs as soon as
// <PeriodSelect> resolves one, and every later change re-runs it. Nothing fires
// while `period` is null, which is also what keeps SSR from fetching (the
// selector resolves on mount, client-side).
watch(period, () => void loadForPeriod(), { immediate: true })

// Beta banner body: the reference design bolds a few key phrases. The i18n
// string marks them with **…** (per-locale, so each translation owns its own
// emphasis); we split on those markers into normal/bold segments — no v-html.
const betaSegments = computed(() =>
  t('page.api.summary.beta.description')
    .split(/\*\*(.+?)\*\*/g)
    .map((text, index) => ({ text, bold: index % 2 === 1 })),
)

// --- Stat cards (6) ---------------------------------------------------------
interface StatCard {
  label: string
  value: number
  unit?: string
  icon: string
}

const statCards = computed<StatCard[]>(() => {
  const k = summary.value?.kpis
  if (!k) return []
  return [
    {
      label: t('page.api.summary.kpis.total_routes'),
      value: k.totalRoutes,
      icon: 'i-ph-tree-structure',
    },
    {
      label: t('page.api.summary.kpis.calls_today'),
      value: k.callsToday,
      icon: 'i-ph-activity',
    },
    {
      label: t('page.api.summary.kpis.avg_latency'),
      value: Math.round(k.averageLatencyMs),
      unit: 'ms',
      icon: 'i-ph-gauge',
    },
    {
      label: t('page.api.summary.kpis.errors_24h'),
      value: k.errors24h,
      icon: 'i-ph-x-circle',
    },
    {
      label: t('page.api.summary.kpis.routes_with_errors_24h'),
      value: k.routesWithErrors24h,
      icon: 'i-ph-warning',
    },
    {
      label: t('page.api.summary.kpis.slow_routes'),
      value: k.slowRoutesCount,
      icon: 'i-ph-clock',
    },
  ]
})

// --- Traffic chart (area, requests vs errors) ------------------------------
const trafficSeries = computed(() => [
  {
    name: t('page.api.summary.history.requests'),
    data: history.value.map((p) => ({ x: p.label, y: p.success })),
    color: C_REQUESTS,
  },
  {
    name: t('page.api.summary.history.errors'),
    data: history.value.map((p) => ({
      x: p.label,
      y: p.clientErrors + p.serverErrors,
    })),
    color: C_ERRORS,
  },
])

const hasTraffic = computed(() =>
  history.value.some((p) => p.success + p.clientErrors + p.serverErrors > 0),
)

// --- Status breakdown -------------------------------------------------------
const breakdownTotal = computed(() => breakdown.value?.total ?? 0)

const donutSegments = computed(() => {
  const b = breakdown.value
  if (!b) return []
  return STATUS_CLASSES.map((s) => ({
    label: t(s.i18nKey),
    value: b[s.key],
    color: s.color,
  }))
})

const breakdownViewItems = computed(() => [
  { label: t('page.api.summary.breakdown.by_day'), value: 'bars' },
  { label: t('page.api.summary.breakdown.donut'), value: 'donut' },
])

// --- Needs attention --------------------------------------------------------
const filteredWatch = computed(() => {
  const q = uriFilter.value.trim().toLowerCase()
  if (!q) return watchList.value
  return watchList.value.filter((w) => w.uri.toLowerCase().includes(q))
})

function severityFor(item: WatchListItem): {
  color: 'error' | 'warning'
  label: string
} {
  if (item.flag === 'broken')
    return { color: 'error', label: t('page.api.summary.watch.severity_critical') }
  return { color: 'warning', label: t('page.api.summary.watch.severity_warning') }
}

// --- Slowest routes ---------------------------------------------------------
const slowest = computed<RouteAggregate[]>(() => {
  const q = uriFilter.value.trim().toLowerCase()
  const list = monitoring.value?.slowest.filter((r) => r.requestsCount > 0) ?? []
  if (!q) return list
  return list.filter((r) => r.uri.toLowerCase().includes(q))
})

// --- Recent requests --------------------------------------------------------
const recent = computed(() => {
  const q = uriFilter.value.trim().toLowerCase()
  const list = monitoring.value?.recent ?? []
  if (!q) return list
  return list.filter((r) => r.uri.toLowerCase().includes(q))
})

// --- Drill-downs --------------------------------------------------------------
// Route rows (needs-attention, slowest, error activity) jump to the Logs page
// pre-filtered on the route URI; recent-request rows open the full log in the
// same drawer as the Logs page. The module pages share the
// /modules/<module>/<page> prefix, so swap the last path segment to stay
// mount-point agnostic.
function goToLogs(uri: string) {
  // Carry the window the user was looking at, or a period-scoped row (e.g. a
  // slowest route whose only traffic is days old) lands on a narrower list than
  // the one the row came from. Both pages speak the same `Nd` values, so it
  // travels as-is. Rows only exist once a window resolved, so the null branch
  // is just there to keep the query clean.
  const logsPeriod = period.value
  void router.push({
    path: route.path.replace(/[^/]+$/, 'logs'),
    query: logsPeriod ? { search: uri, period: logsPeriod } : { search: uri },
  })
}

const { loadingDetailId, openLogDetail } = useLogDetailDrawer()

// --- Helpers ----------------------------------------------------------------
function fmtPct(rate: number): string {
  return `${(Math.round(rate * 10000) / 100).toFixed(2)}%`
}

function fmtTime(ts: string): string {
  return new Date(ts).toLocaleTimeString()
}

function activityAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return t('page.api.summary.activity.ago_now')
  if (m < 60) return t('page.api.summary.activity.ago_minutes', { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('page.api.summary.activity.ago_hours', { n: h })
  return t('page.api.summary.activity.ago_days', { n: Math.floor(h / 24) })
}
</script>

<template>
  <div class="flex w-full flex-col gap-5 p-6">
    <!-- Beta banner -->
    <DmsBanner
      icon="i-ph-info"
      color="warning"
      :title="$t('page.api.summary.beta.title')"
    >
      <template #description>
        <span>
          <template v-for="(seg, i) in betaSegments" :key="i"
            ><strong v-if="seg.bold" class="font-semibold text-toned">{{
              seg.text
            }}</strong
            ><template v-else>{{ seg.text }}</template></template
          >
        </span>
      </template>
    </DmsBanner>

    <!-- Page head -->
    <header class="flex flex-wrap items-center gap-4">
      <div
        class="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"
      >
        <UIcon name="i-ph-gauge" class="size-[22px]" />
      </div>
      <div class="min-w-0 flex-1">
        <h1 class="text-2xl font-semibold tracking-tight text-highlighted">
          {{ $t('page.api.summary.title') }}
        </h1>
        <p class="text-sm text-muted">
          {{ $t('page.api.summary.description') }}
        </p>
      </div>
      <div class="flex items-center gap-2.5">
        <UInput
          v-model="uriFilter"
          icon="i-ph-funnel"
          size="sm"
          :placeholder="$t('page.api.summary.filter_placeholder')"
          class="w-56"
        />
        <PeriodSelect v-model="period" class="w-32" />
        <UButton
          icon="i-ph-arrow-clockwise"
          color="neutral"
          variant="subtle"
          size="sm"
          :loading="loading"
          @click="load"
        >
          {{ $t('page.api.logs.refresh') }}
        </UButton>
      </div>
    </header>

    <div
      v-if="error"
      class="rounded-lg border border-error bg-error/10 p-3 text-sm text-error"
    >
      {{ error }}
    </div>

    <template v-else>
      <!-- Stat cards -->
      <div
        v-if="statCards.length"
        class="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6"
      >
        <DmsKpiCard
          v-for="c in statCards"
          :key="c.label"
          variant="stat"
          :show-delta="false"
          :title="c.label"
          :icon="c.icon"
          :static-value="c.value"
          :value-format="c.unit ? 'number' : 'compact'"
          :compare-label="c.unit"
        />
      </div>
      <div v-else class="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <DmsCard v-for="i in 6" :key="i" :padded="false" class="p-5">
          <USkeleton class="h-3 w-3/5" />
          <USkeleton class="mt-3 h-7 w-2/5" />
        </DmsCard>
      </div>

      <!-- Traffic chart + status breakdown -->
      <div class="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <DmsCard :padded="false" class="overflow-hidden">
          <div class="flex items-start justify-between gap-3 px-5 pt-5 sm:px-6">
            <div>
              <h2 class="text-base font-semibold text-highlighted">
                {{ $t('page.api.summary.history.title') }}
              </h2>
              <p class="text-sm text-dimmed">
                {{ $t('page.api.summary.history.subtitle') }}
              </p>
            </div>
            <div class="flex items-center gap-3 text-xs text-muted">
              <span class="flex items-center gap-1.5">
                <span
                  class="size-2.5 rounded-full"
                  :style="{ background: C_REQUESTS }"
                />
                {{ $t('page.api.summary.history.requests') }}
              </span>
              <span class="flex items-center gap-1.5">
                <span
                  class="size-2.5 rounded-full"
                  :style="{ background: C_ERRORS }"
                />
                {{ $t('page.api.summary.history.errors') }}
              </span>
            </div>
          </div>
          <div class="px-2 pb-2 pt-2">
            <DmsChart
              v-if="hasTraffic"
              type="area"
              :static-dataset="trafficSeries"
              :smooth="true"
              :show-legend="false"
              :color="[C_REQUESTS, C_ERRORS]"
              height="300px"
            />
            <div
              v-else
              class="flex flex-col items-center justify-center gap-2 text-dimmed"
              style="height: 300px"
            >
              <UIcon name="i-ph-chart-line" class="size-7" />
              <small>{{ $t('page.api.summary.history.empty') }}</small>
            </div>
          </div>
        </DmsCard>

        <DmsCard :padded="false" class="overflow-hidden">
          <div class="flex items-start justify-between gap-3 px-5 pt-5 sm:px-6">
            <div>
              <h2 class="text-base font-semibold text-highlighted">
                {{ $t('page.api.summary.breakdown.title') }}
              </h2>
              <p class="text-sm text-dimmed">
                {{ $t('page.api.summary.breakdown.subtitle') }}
              </p>
            </div>
            <DmsSegmented
              v-model="breakdownView"
              :items="breakdownViewItems"
              :aria-label="$t('page.api.summary.breakdown.title')"
            />
          </div>
          <div class="px-2 pb-4 pt-3">
            <template v-if="breakdownTotal > 0">
              <StatusDonut
                v-if="breakdownView === 'donut'"
                :segments="donutSegments"
                :total="breakdownTotal"
                :center-sub-label="$t('page.api.summary.breakdown.responses')"
              />
              <StatusBreakdownBars v-else :history="history" />
            </template>
            <div
              v-else
              class="flex flex-col items-center justify-center gap-2 text-dimmed"
              style="height: 280px"
            >
              <UIcon name="i-ph-chart-donut" class="size-7" />
              <small>{{ $t('page.api.summary.breakdown.empty') }}</small>
            </div>
          </div>
        </DmsCard>
      </div>

      <!-- Needs attention + slowest routes -->
      <div class="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <DmsCard :padded="false" class="overflow-hidden">
          <div
            class="flex items-center justify-between gap-3 border-b border-default px-5 py-4 sm:px-6"
          >
            <div>
              <h2 class="text-base font-semibold text-highlighted">
                {{ $t('page.api.summary.watch.title') }}
              </h2>
              <p class="text-sm text-dimmed">
                {{ $t('page.api.summary.watch.subtitle') }}
              </p>
            </div>
            <UBadge color="neutral" variant="subtle">{{ filteredWatch.length }}</UBadge>
          </div>
          <div
            v-if="filteredWatch.length === 0"
            class="flex flex-col items-center gap-2 px-6 py-8 text-center"
          >
            <UIcon name="i-ph-check-circle" class="size-7 text-success" />
            <b class="text-sm text-highlighted">
              {{ $t('page.api.summary.watch.empty_title') }}
            </b>
            <small class="text-dimmed">
              {{ $t('page.api.summary.watch.empty_description') }}
            </small>
          </div>
          <div v-else class="divide-y divide-default">
            <DmsActivityItem
              v-for="item in filteredWatch"
              :key="item.routeKey"
              mono
              class="cursor-pointer"
              @click="goToLogs(item.uri)"
            >
              <ApiMethodBadge :method="item.method" />
              <span class="truncate">{{ item.uri }}</span>
              <template #subtitle>
                {{ item.requestsLast24h }}
                {{ $t('page.api.summary.watch.requests_24h') }}
                · <span class="text-error">{{ fmtPct(item.errorRate) }}</span>
                · {{ Math.round(item.averageLatencyMs) }} ms
              </template>
              <template #trailing>
                <UBadge :color="severityFor(item).color" variant="subtle" size="sm">
                  {{ severityFor(item).label }}
                </UBadge>
              </template>
            </DmsActivityItem>
          </div>
        </DmsCard>

        <DmsCard :padded="false" class="overflow-hidden">
          <div class="border-b border-default px-5 py-4 sm:px-6">
            <h2 class="text-base font-semibold text-highlighted">
              {{ $t('page.api.summary.slowest.title') }}
            </h2>
            <p class="text-sm text-dimmed">
              {{ $t('page.api.summary.slowest.subtitle') }}
            </p>
          </div>
          <div
            v-if="slowest.length === 0"
            class="flex flex-col items-center gap-2 px-6 py-8 text-center"
          >
            <UIcon name="i-ph-clock" class="size-7 text-dimmed" />
            <small class="text-dimmed">{{ $t('page.api.summary.slowest.empty') }}</small>
          </div>
          <div v-else class="divide-y divide-default">
            <DmsActivityItem
              v-for="r in slowest"
              :key="r.routeKey"
              mono
              class="cursor-pointer"
              @click="goToLogs(r.uri)"
            >
              <ApiMethodBadge :method="r.method" />
              <span class="truncate">{{ r.uri }}</span>
              <template #trailing>
                <span class="text-toned">{{ Math.round(r.averageLatencyMs) }} ms</span>
                <span class="ml-3 text-dimmed">{{ Math.round(r.maxLatencyMs) }} ms</span>
              </template>
            </DmsActivityItem>
          </div>
        </DmsCard>
      </div>

      <!-- Recent requests + activity -->
      <div class="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <DmsCard :padded="false" class="overflow-hidden">
          <div class="border-b border-default px-5 py-4 sm:px-6">
            <h2 class="text-base font-semibold text-highlighted">
              {{ $t('page.api.summary.recent.title') }}
            </h2>
            <p class="text-sm text-dimmed">
              {{ $t('page.api.summary.recent.subtitle') }}
            </p>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr
                  class="border-b border-default text-left font-mono text-[10px] uppercase tracking-widest text-dimmed"
                >
                  <th class="px-5 py-2.5 sm:px-6">
                    {{ $t('page.api.summary.recent.col_time') }}
                  </th>
                  <th class="px-2 py-2.5">{{ $t('page.api.summary.recent.col_method') }}</th>
                  <th class="px-2 py-2.5">{{ $t('page.api.summary.recent.col_path') }}</th>
                  <th class="px-2 py-2.5">{{ $t('page.api.summary.recent.col_status') }}</th>
                  <th class="px-5 py-2.5 text-right sm:px-6">
                    {{ $t('page.api.summary.recent.col_ms') }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="recent.length === 0">
                  <td colspan="5" class="px-6 py-8 text-center text-dimmed">
                    {{ $t('page.api.summary.recent.empty') }}
                  </td>
                </tr>
                <tr
                  v-for="row in recent"
                  :key="row._id"
                  class="cursor-pointer border-b border-default/60 last:border-0 hover:bg-elevated/40"
                  @click="openLogDetail(row)"
                >
                  <td class="px-5 py-2 font-mono text-xs text-muted sm:px-6">
                    {{ fmtTime(row.timestamp) }}
                  </td>
                  <td class="px-2 py-2">
                    <ApiMethodBadge :method="row.method" />
                  </td>
                  <td class="px-2 py-2 font-mono text-xs text-toned">{{ row.uri }}</td>
                  <td class="px-2 py-2">
                    <ApiStatusBadge :status="row.statusCode" />
                  </td>
                  <td class="px-5 py-2 text-right font-mono text-xs text-muted sm:px-6">
                    {{ Math.round(row.responseTimeMs) }}
                    <UIcon
                      v-if="loadingDetailId === row._id"
                      name="i-ph-spinner"
                      class="ml-1 animate-spin"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </DmsCard>

        <DmsCard :padded="false" class="overflow-hidden">
          <div class="border-b border-default px-5 py-4 sm:px-6">
            <h2 class="text-base font-semibold text-highlighted">
              {{ $t('page.api.summary.activity.title') }}
            </h2>
            <p class="text-sm text-dimmed">
              {{ $t('page.api.summary.activity.subtitle') }}
            </p>
          </div>
          <div
            v-if="activity.length === 0"
            class="flex flex-col items-center gap-2 px-6 py-8 text-center"
          >
            <UIcon name="i-ph-clock" class="size-7 text-dimmed" />
            <small class="text-dimmed">
              {{ $t('page.api.summary.activity.empty_description') }}
            </small>
          </div>
          <div v-else class="divide-y divide-default">
            <DmsActivityItem
              v-for="(item, idx) in activity"
              :key="`${item.kind}-${item.timestamp}-${idx}`"
              :icon="item.kind === 'error' ? 'i-ph-x-circle' : 'i-ph-plus'"
              :icon-color="item.kind === 'error' ? 'error' : 'success'"
              :trailing="activityAgo(item.timestamp)"
              :class="item.kind === 'error' ? 'cursor-pointer' : ''"
              @click="item.kind === 'error' && goToLogs(item.uri)"
            >
              <span>
                {{
                  item.kind === 'error'
                    ? $t('page.api.summary.activity.error')
                    : $t('page.api.summary.activity.route_created')
                }}
              </span>
              <ApiMethodBadge :method="item.method" />
              <span class="truncate font-mono text-[12px]">{{ item.uri }}</span>
              <ApiStatusBadge v-if="item.statusCode" :status="item.statusCode" />
            </DmsActivityItem>
          </div>
        </DmsCard>
      </div>
    </template>
  </div>
</template>
