<script setup lang="ts">
import { computed } from 'vue'
import type {
  ChartDataPoint,
  ApiChartResponse,
  RouteStatsPayload,
} from '../composables/useApiIntrospection'
import ApiMethodBadge from './internal/ApiMethodBadge.vue'
import ApiStatusBadge from './internal/ApiStatusBadge.vue'
import UnitAreaChart from './internal/UnitAreaChart.vue'
import {
  STATUS_CLASS_COLOR_BY_CATEGORY,
  STATUS_CLASS_COLORS,
  STATUS_CLASSES,
} from '../utils/statusClass'

// Statistics tab of a route detail (DMS apiv2-routes): four stat-cards +
// "Requests by status" / "Response time" area charts + recent-requests table.
const props = defineProps<{
  stats: RouteStatsPayload
}>()

const { loadingDetailId, openLogDetail } = useLogDetailDrawer()

const aggregate = computed(() => props.stats.aggregate)

const kpis = computed(() => {
  const a = aggregate.value
  return {
    requests: a?.requestsCount ?? 0,
    avgLatencyMs: a ? Math.round(a.averageLatencyMs) : 0,
    errorRate: a ? Math.round(a.errorRate * 10000) / 100 : 0,
    maxLatencyMs: a ? Math.round(a.maxLatencyMs) : 0,
  }
})

// errorRate is expressed as a percentage here (see kpis above): 20% mirrors the
// backend "down" ratio (0.2), 5% the "elevated" ratio (0.05).
const ERROR_RATE_CRITICAL_PCT = 20
const ERROR_RATE_WARNING_PCT = 5

const errorTone = computed(() => {
  const r = kpis.value.errorRate
  if (r > ERROR_RATE_CRITICAL_PCT) return 'text-error'
  if (r > ERROR_RATE_WARNING_PCT) return 'text-warning'
  return 'text-highlighted'
})

// The latency series are not status classes, so they carry their own accents;
// the min/max pair deliberately borrows the good/bad ends of STATUS_CLASSES.
const C_LATENCY = '#4dd9e6'
const C_BEST = STATUS_CLASSES[0].color
const C_WORST = STATUS_CLASSES[2].color

// Every latency the backend reports is in milliseconds (RouteStatistics stores
// `responseTime` in ms), so the whole Response time chart shares one unit.
const LATENCY_UNIT = 'ms'

function seriesByCategory(
  payload: ApiChartResponse,
  colors: Record<string, string>,
) {
  const buckets = new Map<string, ChartDataPoint[]>()
  for (const point of payload.data ?? []) {
    const key = point.category ?? 'Other'
    const list = buckets.get(key) ?? []
    list.push(point)
    buckets.set(key, list)
  }
  return [...buckets.entries()].map(([name, data]) => ({
    name,
    data: data.map((d) => ({ x: d.x, y: d.y })),
    color: colors[name] ?? '#6b7280',
  }))
}

// The backend tags these points with the same category names STATUS_CLASSES
// carries, so the chart and the overview colour the same class identically.
const countsSeries = computed(() =>
  seriesByCategory(props.stats.charts.counts, STATUS_CLASS_COLOR_BY_CATEGORY),
)
// The backend emits latency categories as Average/Min/Max; the legend must
// read Max, Average, Min.
const LATENCY_ORDER = ['Max', 'Average', 'Min']
const latencySeries = computed(() =>
  seriesByCategory(props.stats.charts.latency, {
    Average: C_LATENCY,
    Min: C_BEST,
    Max: C_WORST,
  })
    .sort(
      (a, b) => LATENCY_ORDER.indexOf(a.name) - LATENCY_ORDER.indexOf(b.name),
    )
    .map((s) => ({
      ...s,
      // Latency values carry many decimals; cap at 2 so the chart axis/tooltip
      // stays readable.
      data: s.data.map((p) => ({ ...p, y: Math.round(p.y * 100) / 100 })),
    })),
)

const hasCounts = computed(() =>
  countsSeries.value.some((s) => s.data.some((p) => p.y > 0)),
)
const hasLatency = computed(() =>
  latencySeries.value.some((s) => s.data.some((p) => p.y > 0)),
)

function fmtTime(ts: string): string {
  return new Date(ts).toLocaleTimeString()
}

</script>

<template>
  <div class="flex w-full flex-col gap-5">
    <!-- stat-cards -->
    <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <DmsCard class="flex flex-col gap-1.5">
        <span class="font-mono text-[10px] uppercase tracking-widest text-dimmed">
          {{ $t('page.api.routes.stats.kpi_requests') }}
        </span>
        <span class="text-2xl font-semibold text-highlighted">
          {{ kpis.requests.toLocaleString() }}
        </span>
      </DmsCard>
      <DmsCard class="flex flex-col gap-1.5">
        <span class="font-mono text-[10px] uppercase tracking-widest text-dimmed">
          {{ $t('page.api.routes.stats.kpi_avg_latency') }}
        </span>
        <span class="text-2xl font-semibold text-highlighted">
          {{ kpis.avgLatencyMs }}<span class="text-sm font-normal text-muted"> ms</span>
        </span>
      </DmsCard>
      <DmsCard class="flex flex-col gap-1.5">
        <span class="font-mono text-[10px] uppercase tracking-widest text-dimmed">
          {{ $t('page.api.routes.stats.kpi_error_rate') }}
        </span>
        <span class="text-2xl font-semibold" :class="errorTone">
          {{ kpis.errorRate }}%
        </span>
      </DmsCard>
      <DmsCard class="flex flex-col gap-1.5">
        <span class="font-mono text-[10px] uppercase tracking-widest text-dimmed">
          {{ $t('page.api.routes.stats.kpi_max_latency') }}
        </span>
        <span class="text-2xl font-semibold text-highlighted">
          {{ kpis.maxLatencyMs }}<span class="text-sm font-normal text-muted"> ms</span>
        </span>
      </DmsCard>
    </div>

    <!-- charts -->
    <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <DmsCard :padded="false" class="overflow-hidden">
        <div class="px-5 pt-4">
          <h3 class="text-sm font-semibold text-highlighted">
            {{ $t('page.api.routes.stats.chart_counts_title') }}
          </h3>
        </div>
        <div class="px-2 pb-2 pt-2">
          <DmsChart
            v-if="hasCounts"
            type="area"
            :static-dataset="countsSeries"
            :smooth="true"
            :show-legend="true"
            :color="STATUS_CLASS_COLORS"
            height="240px"
          />
          <div
            v-else
            class="flex flex-col items-center justify-center gap-2 text-dimmed"
            style="height: 240px"
          >
            <UIcon name="i-ph-chart-line" class="size-6" />
            <small>{{ $t('page.api.routes.stats.chart_empty') }}</small>
          </div>
        </div>
      </DmsCard>

      <DmsCard :padded="false" class="overflow-hidden">
        <div class="px-5 pt-4">
          <h3 class="text-sm font-semibold text-highlighted">
            {{ $t('page.api.routes.stats.chart_latency_title') }}
          </h3>
        </div>
        <div class="px-2 pb-2 pt-2">
          <UnitAreaChart
            v-if="hasLatency"
            :series="latencySeries"
            :unit="LATENCY_UNIT"
            :colors="[C_WORST, C_LATENCY, C_BEST]"
            height="240px"
          />
          <div
            v-else
            class="flex flex-col items-center justify-center gap-2 text-dimmed"
            style="height: 240px"
          >
            <UIcon name="i-ph-chart-line" class="size-6" />
            <small>{{ $t('page.api.routes.stats.chart_empty') }}</small>
          </div>
        </div>
      </DmsCard>
    </div>

    <!-- recent requests -->
    <DmsCard :padded="false" class="overflow-hidden">
      <div class="border-b border-default px-5 py-3.5">
        <h3 class="text-sm font-semibold text-highlighted">
          {{ $t('page.api.routes.stats.recent_title') }}
        </h3>
      </div>

      <div
        v-if="stats.recent.length === 0"
        class="flex flex-col items-center gap-2 px-6 py-8 text-center text-dimmed"
      >
        <UIcon name="i-ph-clock-counter-clockwise" class="size-6" />
        <small>{{ $t('page.api.routes.stats.recent_empty_title') }}</small>
      </div>

      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr
              class="border-b border-default text-left font-mono text-[10px] uppercase tracking-widest text-dimmed"
            >
              <th class="px-5 py-2.5">{{ $t('page.api.routes.stats.col_time') }}</th>
              <th class="px-2 py-2.5">{{ $t('page.api.routes.stats.col_method') }}</th>
              <th class="px-2 py-2.5">{{ $t('page.api.routes.stats.col_path') }}</th>
              <th class="px-2 py-2.5">{{ $t('page.api.routes.stats.col_status') }}</th>
              <th class="px-5 py-2.5 text-right">{{ $t('page.api.routes.stats.col_ms') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in stats.recent"
              :key="row._id"
              class="cursor-pointer border-b border-default/60 last:border-0 hover:bg-elevated/40"
              @click="openLogDetail(row)"
            >
              <td class="px-5 py-2 font-mono text-xs text-muted">
                {{ fmtTime(row.timestamp) }}
              </td>
              <td class="px-2 py-2">
                <ApiMethodBadge :method="row.method" />
              </td>
              <td class="px-2 py-2 font-mono text-xs text-toned">{{ row.uri }}</td>
              <td class="px-2 py-2">
                <ApiStatusBadge :status="row.statusCode" />
              </td>
              <td class="px-5 py-2 text-right font-mono text-xs text-muted">
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
  </div>
</template>
