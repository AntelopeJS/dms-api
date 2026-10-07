<script setup lang="ts">
import { computed } from 'vue'
import {
  formatAgo,
  formatClock,
  formatCount,
  formatDateTime,
  formatMs,
  formatPercent,
} from '../../utils/format'
import ApiStatusBadge from '../internal/ApiStatusBadge.vue'
import RequestDetail from './RequestDetail.vue'

// The Statistics tab of a route: its traffic and latency over the page's
// period, why it fails (errors grouped by status and message) and its last
// requests, each opening in the request drawer.
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    fetchUrl: string
    queryKey?: string
    periodScope?: string
    pageId?: string
    componentId?: string
  }>(),
  {
    queryKey: 'route',
    periodScope: undefined,
    pageId: '',
    componentId: 'route-statistics',
  },
)

interface Bucket {
  start: number
  success: number
  clientErrors: number
  serverErrors: number
  average: number
  min: number
  max: number
}

interface TopError {
  status: number
  message: string | null
  count: number
  last: string
}

interface RecentRequest {
  _id: string
  timestamp: string
  rawPath: string
  statusCode: number
  responseTimeMs: number
  ip?: string
}

interface RouteStatistics {
  requests: number
  previousRequests: number | null
  averageLatency: number
  minLatency: number
  maxLatency: number
  maxLatencyAt: string | null
  maxLatencyRequestId: string | null
  clientErrors: number
  serverErrors: number
  errorRate: number
  slowThreshold: number
  granularity: 'hour' | 'day'
  buckets: Bucket[]
  topErrors: TopError[]
  recent: RecentRequest[]
}

const PERCENT = 100

const { t } = useI18n()
const locale = useFormatLocale()
const drawer = useDrawer()
const selection = useRouteSelection(props.queryKey)
const scope = usePeriodScope(props.periodScope)

const url = computed(() => {
  if (!selection.ref.value) return null
  const base = `${props.fetchUrl}?${new URLSearchParams({ route: selection.ref.value })}`
  if (!props.periodScope) return base
  return scope.value ? (appendPeriodToUrl(base, scope.value) ?? null) : null
})

const {
  data: stats,
  error,
  pending,
  refresh,
} = useApiResource<RouteStatistics>(() => url.value)

const count = (value: number) => formatCount(value, locale.value)

const delta = computed(() => {
  const value = stats.value
  if (!value || !value.previousRequests) return null
  return (
    ((value.requests - value.previousRequests) / value.previousRequests) *
    PERCENT
  )
})

const kpis = computed(() => {
  const value = stats.value
  if (!value) return []
  const change = delta.value
  return [
    {
      id: 'requests',
      eyebrow: t('api.routes.statistics.requests'),
      value: count(value.requests),
      detail:
        change === null
          ? t('api.routes.statistics.no_baseline')
          : t('api.routes.statistics.vs_previous', {
              delta: `${change > 0 ? '+' : ''}${formatPercent(change, locale.value)}`,
            }),
      detailTone:
        change === null
          ? ('neutral' as const)
          : change >= 0
            ? ('success' as const)
            : ('warning' as const),
    },
    {
      id: 'latency',
      eyebrow: t('api.routes.statistics.average'),
      value: formatMs(value.averageLatency, locale.value),
      detail: t('api.routes.statistics.min', {
        min: formatMs(value.minLatency, locale.value),
      }),
    },
    {
      id: 'errors',
      eyebrow: t('api.routes.statistics.error_rate'),
      value: formatPercent(value.errorRate * PERCENT, locale.value),
      detail: t('api.routes.statistics.error_split', {
        client: count(value.clientErrors),
        server: count(value.serverErrors),
      }),
      detailTone:
        value.serverErrors > 0 ? ('error' as const) : ('neutral' as const),
    },
    {
      id: 'max',
      eyebrow: t('api.routes.statistics.max'),
      value: formatMs(value.maxLatency, locale.value),
      detail: value.maxLatencyAt
        ? formatDateTime(value.maxLatencyAt, locale.value)
        : '—',
      detailTone:
        value.maxLatency >= value.slowThreshold
          ? ('warning' as const)
          : ('neutral' as const),
    },
  ]
})

const statusSeries = computed(() => {
  const buckets = stats.value?.buckets ?? []
  return [
    {
      name: '2xx',
      data: buckets.map((bucket) => ({ x: bucket.start, y: bucket.success })),
    },
    {
      name: '4xx',
      data: buckets.map((bucket) => ({
        x: bucket.start,
        y: bucket.clientErrors,
      })),
    },
    {
      name: '5xx',
      data: buckets.map((bucket) => ({
        x: bucket.start,
        y: bucket.serverErrors,
      })),
    },
  ]
})

const latencySeries = computed(() => {
  const buckets = (stats.value?.buckets ?? []).filter(
    (bucket) => bucket.success + bucket.clientErrors + bucket.serverErrors > 0,
  )
  return [
    {
      name: t('api.routes.statistics.series_average'),
      data: buckets.map((bucket) => ({ x: bucket.start, y: bucket.average })),
    },
    {
      name: t('api.routes.statistics.series_max'),
      data: buckets.map((bucket) => ({ x: bucket.start, y: bucket.max })),
    },
    {
      name: t('api.routes.statistics.series_min'),
      data: buckets.map((bucket) => ({ x: bucket.start, y: bucket.min })),
    },
  ]
})

const threshold = computed(() =>
  stats.value
    ? [
        {
          y: stats.value.slowThreshold,
          label: t('api.routes.statistics.slow_line', {
            threshold: formatMs(stats.value.slowThreshold, locale.value),
          }),
          color: 'warning',
        },
      ]
    : [],
)

function errorLink(group: TopError): string {
  const query = new URLSearchParams({ route: selection.ref.value ?? '' })
  if (group.message) query.set('error', group.message)
  query.set('requests.tab', group.status >= 500 ? '5xx' : '4xx')
  return `/modules/api/logs?${query}`
}

const logsLink = computed(() =>
  selection.ref.value
    ? `/modules/api/logs?${new URLSearchParams({ route: selection.ref.value })}`
    : '/modules/api/logs',
)

function ago(value: string): string {
  const relative = formatAgo(value)
  return relative
    ? t(`api.common.ago_${relative.unit}`, { amount: relative.amount })
    : ''
}

function openRequest(request: RecentRequest) {
  drawer.open({
    title: t('api.logs.drawer_title'),
    component: RequestDetail,
    componentOptions: { rowData: { _id: request._id } },
  })
}

const currentRoute = useDmsRoute()
const router = useDmsRouter()

function openTester() {
  void router.push({ query: { ...currentRoute.query, tab: '2' } })
}
</script>

<template>
  <div v-if="!selection.ref.value" />
  <div v-else-if="pending" class="flex flex-col gap-4">
    <DmsStatGroup :loading="true" :skeleton-count="4" />
    <div class="grid gap-4 lg:grid-cols-2">
      <USkeleton class="h-56" />
      <USkeleton class="h-56" />
    </div>
  </div>
  <DmsCard v-else-if="!stats" :padded="false" class="py-6">
    <DmsEmptyState
      variant="error"
      :title="t('api.routes.statistics.error')"
      :actions="[{ label: t('api.common.retry'), onClick: () => refresh() }]"
    />
  </DmsCard>
  <DmsCard v-else-if="stats.requests === 0" :padded="false" class="py-8">
    <DmsEmptyState
      size="lg"
      icon="i-ph-wave-sine"
      :title="t('api.routes.statistics.no_calls_title')"
      :description="t('api.routes.statistics.no_calls_description')"
      :actions="[
        {
          label: t('api.routes.statistics.send_test'),
          icon: 'i-ph-paper-plane-tilt',
          onClick: openTester,
        },
      ]"
    />
  </DmsCard>
  <div v-else class="flex flex-col gap-4">
    <DmsStatGroup :items="kpis" :label="t('api.routes.statistics.title')" />
    <p v-if="error" class="text-warning text-xs">{{ t('api.common.stale') }}</p>

    <div class="grid gap-4 xl:grid-cols-2">
      <DmsChart
        :title="t('api.routes.statistics.by_status')"
        :page-id="pageId ?? ''"
        :component-id="`${componentId ?? 'api'}-status`"
        type="column"
        height="220px"
        :static-dataset="statusSeries"
        :color="['--dms-chart-1', 'warning', 'error']"
        stacked
        xaxis-type="datetime"
      />
      <DmsChart
        :title="t('api.routes.statistics.response_time')"
        :page-id="pageId ?? ''"
        :component-id="`${componentId ?? 'api'}-latency`"
        type="line"
        height="220px"
        :static-dataset="latencySeries"
        :color="['--dms-chart-1', 'error', 'success']"
        :annotations="threshold"
        :auto-y-range="{ padding: 0.1 }"
        xaxis-type="datetime"
        curve="smooth"
      />
    </div>

    <div class="grid gap-4 2xl:grid-cols-2">
      <DmsCard
        :title="t('api.routes.statistics.top_errors')"
        :count="stats.topErrors.length || undefined"
        :padded="false"
      >
        <DmsEmptyState
          v-if="stats.topErrors.length === 0"
          size="sm"
          icon="i-ph-check-circle"
          tone="success"
          :title="t('api.routes.statistics.no_errors')"
        />
        <ul v-else class="divide-default divide-y">
          <li
            v-for="group in stats.topErrors"
            :key="`${group.status}-${group.message}`"
          >
            <UButton
              :to="errorLink(group)"
              color="neutral"
              variant="ghost"
              block
              class="justify-start rounded-none px-4 py-3 text-left"
              trailing-icon="i-ph-arrow-right"
            >
              <span class="flex min-w-0 grow flex-col gap-1">
                <span class="flex min-w-0 items-center gap-2">
                  <ApiStatusBadge :status="group.status" size="sm" />
                  <span class="text-highlighted truncate text-sm">
                    {{ group.message || t('api.routes.statistics.no_message') }}
                  </span>
                </span>
                <span class="text-dimmed text-xs">
                  {{
                    t(
                      'api.routes.statistics.calls',
                      { count: count(group.count) },
                      group.count,
                    )
                  }}
                  ·
                  {{
                    t('api.routes.statistics.last', { ago: ago(group.last) })
                  }}
                </span>
              </span>
            </UButton>
          </li>
        </ul>
      </DmsCard>

      <DmsCard :title="t('api.routes.statistics.recent')" :padded="false">
        <template #actions>
          <UButton
            :to="logsLink"
            size="xs"
            variant="link"
            trailing-icon="i-ph-arrow-right"
            :label="t('api.routes.statistics.all_requests')"
          />
        </template>
        <table class="w-full text-[12.5px]">
          <thead>
            <tr
              class="text-dimmed font-mono text-[10.5px] uppercase tracking-[0.08em]"
            >
              <th class="px-4 py-2 text-left font-medium">
                {{ t('api.logs.columns.time') }}
              </th>
              <th class="px-2 py-2 text-left font-medium">
                {{ t('api.logs.columns.status') }}
              </th>
              <th class="px-2 py-2 text-left font-medium">
                {{ t('api.logs.columns.path') }}
              </th>
              <th class="px-4 py-2 text-right font-medium">
                {{ t('api.logs.columns.duration') }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-default divide-y">
            <tr
              v-for="request in stats.recent"
              :key="request._id"
              class="hover:bg-elevated cursor-pointer"
              tabindex="0"
              @click="openRequest(request)"
              @keydown.enter="openRequest(request)"
            >
              <td class="text-muted px-4 py-2 font-mono tabular-nums">
                {{ formatClock(request.timestamp, locale) }}
              </td>
              <td class="px-2 py-2">
                <ApiStatusBadge :status="request.statusCode" size="sm" />
              </td>
              <td class="text-default max-w-0 truncate px-2 py-2 font-mono">
                {{ request.rawPath }}
              </td>
              <td
                class="px-4 py-2 text-right font-mono tabular-nums"
                :class="
                  request.responseTimeMs >= stats.slowThreshold
                    ? 'text-warning font-semibold'
                    : 'text-muted'
                "
              >
                {{ formatMs(request.responseTimeMs, locale) }}
              </td>
            </tr>
          </tbody>
        </table>
      </DmsCard>
    </div>
  </div>
</template>
