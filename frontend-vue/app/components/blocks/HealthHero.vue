<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import {
  formatClock,
  formatCount,
  formatDateTime,
  formatPercent,
} from '../../utils/format'

// The verdict leads the Overview: is the API healthy, since when, why not,
// and the one action that starts the investigation. With no request captured
// yet, the same place explains how to get the first one in.
defineOptions({ inheritAttrs: false })

const props = defineProps<{ fetchUrl: string }>()

type Verdict = 'down' | 'degraded' | 'operational' | 'idle'

interface HealthMetric {
  value: number
  delta?: number | null
}

interface HealthPayload {
  verdict: Verdict
  since: string | null
  checkedAt: string
  failingRoutes: number
  slowRoutes: number
  serverErrors: number
  calls: HealthMetric
  errors: HealthMetric & { share: number }
  latency: HealthMetric & { max: number }
  routes: HealthMetric & { needingAttention: number }
  serverErrorsLink: string
  firstRun: boolean
}

const REFRESH_MS = 30_000

const STATUS: Record<Verdict, 'ok' | 'warn' | 'down' | 'info'> = {
  operational: 'ok',
  degraded: 'warn',
  down: 'down',
  idle: 'info',
}

const { t } = useI18n()
const locale = useFormatLocale()
const { data, error, pending, receivedAt, refresh } =
  useApiResource<HealthPayload>(() => props.fetchUrl)

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => void refresh(), REFRESH_MS)
})
onBeforeUnmount(() => clearInterval(timer))

const count = (value: number) => formatCount(value, locale.value)

const since = computed(() => {
  const health = data.value
  if (!health) return ''
  const checked = t('api.health.checked', {
    time: formatClock(health.checkedAt, locale.value),
  })
  if (!health.since) return checked
  const key =
    health.verdict === 'operational'
      ? 'api.health.last_incident'
      : 'api.health.since'
  return `${t(key, { date: formatDateTime(health.since, locale.value) })} · ${checked}`
})

const callsSub = computed(() => {
  const delta = data.value?.calls.delta
  if (delta === null || delta === undefined)
    return t('api.health.metrics.calls_no_baseline')
  const sign = delta > 0 ? '+' : ''
  return t('api.health.metrics.calls_delta', {
    delta: `${sign}${formatPercent(delta, locale.value)}`,
  })
})

const metrics = computed(() => {
  const health = data.value
  if (!health) return []
  return [
    {
      label: t('api.health.metrics.calls'),
      value: count(health.calls.value),
      sub: callsSub.value,
    },
    {
      label: t('api.health.metrics.errors'),
      value: formatPercent(health.errors.share, locale.value).replace(' %', ''),
      unit: '%',
      sub: t('api.health.metrics.errors_sub', {
        count: count(health.errors.value),
      }),
      tone:
        health.errors.share >= 5
          ? ('error' as const)
          : health.errors.share > 0
            ? ('warning' as const)
            : ('default' as const),
    },
    {
      label: t('api.health.metrics.latency'),
      value: count(health.latency.value),
      unit: 'ms',
      sub: t('api.health.metrics.latency_sub', {
        max: count(health.latency.max),
      }),
    },
    {
      label: t('api.health.metrics.routes'),
      value: count(health.routes.value),
      sub: t('api.health.metrics.routes_sub', {
        count: health.routes.needingAttention,
      }),
      tone:
        health.routes.needingAttention > 0
          ? ('warning' as const)
          : ('default' as const),
    },
  ]
})

const stale = computed(() => !!error.value && !!data.value)
const staleSince = computed(() =>
  receivedAt.value ? formatClock(receivedAt.value, locale.value) : '',
)
</script>

<template>
  <section class="flex flex-col gap-3" :aria-busy="pending">
    <DmsCard v-if="pending" :padded="false" class="px-6 py-6">
      <div class="flex items-center gap-6">
        <USkeleton class="size-16 rounded-full" />
        <div class="flex flex-col gap-2">
          <USkeleton class="h-3 w-28" />
          <USkeleton class="h-7 w-40" />
          <USkeleton class="h-3 w-52" />
        </div>
        <div class="ml-auto hidden flex-1 grid-cols-4 gap-6 lg:grid">
          <div v-for="index in 4" :key="index" class="flex flex-col gap-2">
            <USkeleton class="h-2.5 w-20" />
            <USkeleton class="h-6 w-16" />
          </div>
        </div>
      </div>
    </DmsCard>

    <DmsCard v-else-if="!data">
      <DmsEmptyState
        variant="error"
        :title="t('api.health.error_title')"
        :description="t('api.health.error_description')"
        :actions="[
          {
            label: t('api.common.retry'),
            icon: 'i-ph-arrow-clockwise',
            onClick: () => refresh(),
          },
        ]"
      />
    </DmsCard>

    <DmsCard v-else-if="data.firstRun" :padded="false" class="px-6 py-7">
      <DmsEmptyState
        size="lg"
        icon="i-ph-broadcast"
        tone="primary"
        :title="t('api.health.first_run.title')"
        :description="
          t('api.health.first_run.description', { count: data.routes.value })
        "
        :actions="[
          {
            label: t('api.health.first_run.browse'),
            icon: 'i-ph-tree-structure',
            to: '/modules/api/routes',
          },
          {
            label: t('api.health.first_run.logs'),
            icon: 'i-ph-list-magnifying-glass',
            color: 'neutral',
            variant: 'outline',
            to: '/modules/api/logs',
          },
        ]"
      />
      <ol
        class="text-muted mx-auto mt-6 grid max-w-3xl gap-3 text-sm sm:grid-cols-3"
      >
        <li
          v-for="step in 3"
          :key="step"
          class="border-default rounded-md border px-3 py-2.5"
        >
          <p class="text-highlighted font-medium">
            <span class="text-primary mr-1 font-mono">{{ step }}</span>
            {{ t(`api.health.first_run.step_${step}`) }}
          </p>
          <p class="text-dimmed mt-0.5 text-xs">
            {{ t(`api.health.first_run.step_${step}_detail`) }}
          </p>
        </li>
      </ol>
    </DmsCard>

    <template v-else>
      <DmsStatusSummary
        :status="STATUS[data.verdict]"
        :status-value="t(`api.health.verdict.${data.verdict}`)"
        :status-label="t('api.health.label')"
        :since="since"
        :metrics="metrics"
        :live="!stale"
      />
      <div class="flex flex-wrap items-center gap-2">
        <DmsStatusPill
          v-if="data.failingRoutes > 0"
          tone="error"
          icon="i-ph-x-circle"
          :mono="false"
          :label="
            t(
              'api.health.reasons.failing',
              { count: data.failingRoutes },
              data.failingRoutes,
            )
          "
        />
        <DmsStatusPill
          v-if="data.slowRoutes > 0"
          tone="warning"
          icon="i-ph-timer"
          :mono="false"
          :label="
            t(
              'api.health.reasons.slow',
              { count: data.slowRoutes },
              data.slowRoutes,
            )
          "
        />
        <span
          v-if="
            data.failingRoutes === 0 &&
            data.slowRoutes === 0 &&
            data.verdict !== 'idle'
          "
          class="text-muted text-sm"
        >
          {{ t('api.health.reasons.none') }}
        </span>
        <span class="grow" />
        <UButton
          v-if="data.serverErrors > 0"
          :to="data.serverErrorsLink"
          color="error"
          variant="soft"
          size="sm"
          icon="i-ph-list-magnifying-glass"
          :label="
            t(
              'api.health.view_errors',
              { count: count(data.serverErrors) },
              data.serverErrors,
            )
          "
        />
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-ph-arrow-clockwise"
          :label="t('api.common.refresh')"
          @click="refresh()"
        />
      </div>
      <DmsBanner
        v-if="stale"
        tone="warning"
        size="sm"
        icon="i-ph-cloud-warning"
        :title="t('api.health.stale_title', { time: staleSince })"
        :description="t('api.health.stale_description')"
      >
        <template #actions>
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            :label="t('api.common.retry')"
            @click="refresh()"
          />
        </template>
      </DmsBanner>
    </template>
  </section>
</template>
