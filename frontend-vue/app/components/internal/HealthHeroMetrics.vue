<script setup lang="ts">
import type { HeroMetric, MetricTone } from '../../utils/health'

// The figures beside the verdict, each with its label and the line under it.
defineProps<{ metrics: HeroMetric[] }>()

const METRIC_TONE: Record<MetricTone, string> = {
  default: 'text-highlighted',
  warning: 'text-warning',
  error: 'text-error',
  muted: 'text-muted',
}
</script>

<template>
  <dl
    class="grid flex-1 grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-[repeat(auto-fit,minmax(96px,1fr))] lg:grid-cols-4"
  >
    <div
      v-for="(metric, index) in metrics"
      :key="metric.id"
      class="min-w-0"
      :class="index > 0 && 'sm:border-muted sm:-ml-6 sm:border-l sm:pl-6'"
    >
      <dt
        class="text-dimmed font-mono text-[10px] font-semibold uppercase tracking-[0.12em]"
      >
        {{ metric.label }}
      </dt>
      <dd
        :class="[
          METRIC_TONE[metric.tone],
          metric.secondary ? 'text-base' : 'text-xl',
        ]"
        class="mt-[7px] whitespace-nowrap font-mono font-semibold tabular-nums leading-[1.1] tracking-[-0.03em]"
      >
        {{ metric.value }}
        <span
          v-if="metric.unit"
          class="text-dimmed ml-0.5 font-sans text-xs font-medium tracking-normal"
        >
          {{ metric.unit }}
        </span>
      </dd>
      <dd class="text-dimmed mt-1 text-[11.5px]">
        {{ metric.sub }}
      </dd>
    </div>
  </dl>
</template>
