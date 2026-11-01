<script setup lang="ts">
import type { DurationScale, RequestLog } from '../../utils/requestDrawer'

// How long the request took against the slow threshold, and how its route
// does lately.
defineProps<{
  log: RequestLog
  timing: DurationScale | null
  ratio: string
  ms: (value: number) => string
  count: (value: number) => string
}>()

const { t } = useI18n()
</script>

<template>
  <section class="flex flex-col gap-2">
    <DmsEyebrow :label="t('api.request.timing')" />
    <template v-if="timing">
      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span class="text-highlighted font-mono text-xl font-semibold">
          {{ ms(log.responseTimeMs ?? 0) }}
        </span>
        <span
          class="text-xs"
          :class="timing.slow ? 'text-warning font-semibold' : 'text-dimmed'"
        >
          {{
            timing.slow
              ? t('api.request.slow_ratio', { ratio })
              : t('api.request.threshold_ratio', { ratio })
          }}
        </span>
      </div>
      <div
        class="bg-elevated relative my-1 h-2 rounded-full"
        role="meter"
        :aria-label="t('api.request.meter_label')"
        aria-valuemin="0"
        :aria-valuemax="Math.round(timing.max)"
        :aria-valuenow="Math.round(log.responseTimeMs ?? 0)"
        :aria-valuetext="ms(log.responseTimeMs ?? 0)"
      >
        <div
          class="h-full rounded-full"
          :class="timing.slow ? 'bg-warning' : 'bg-primary'"
          :style="{ width: `${timing.share}%` }"
        />
        <div
          class="bg-inverted/60 absolute -inset-y-1 w-0.5 rounded-full"
          :style="{ left: `${timing.threshold}%` }"
          aria-hidden="true"
        />
      </div>
      <!-- The threshold, then how the route does lately: each its own
              line, at every width. -->
      <div class="text-dimmed flex flex-col gap-1 text-xs">
        <p>
          {{
            t('api.request.threshold', {
              threshold: ms(log.slowThresholdMs),
            })
          }}
        </p>
        <p v-if="log.routeLatency" class="font-mono tabular-nums">
          {{
            t(
              'api.request.route_latency',
              {
                days: count(log.routeLatency.windowDays),
                p50: ms(log.routeLatency.p50),
                p95: ms(log.routeLatency.p95),
              },
              log.routeLatency.windowDays,
            )
          }}
        </p>
      </div>
    </template>
    <p v-else class="text-dimmed text-sm">
      {{ t('api.request.not_measured_hint') }}
    </p>
  </section>
</template>
