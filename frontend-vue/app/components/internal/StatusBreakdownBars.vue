<script setup lang="ts">
import { computed } from 'vue'
import type { HistoryPoint } from '../../composables/useApiIntrospection'
import { STATUS_CLASSES } from '../../utils/statusClass'

// "By day" view of the status breakdown (DMS apiv2-overview): one horizontal
// stacked bar per day, split by status class on a rounded track — with a
// "high error day" warning badge on days whose error rate clears the
// threshold, an x-axis scale and a legend. ApexCharts can't render the
// per-row badges or rounded tracks, so this is a hand-built bar chart.
const props = defineProps<{
  history: HistoryPoint[]
  highErrorThreshold?: number
}>()

const threshold = computed(() => props.highErrorThreshold ?? 0.3)

interface DaySegment {
  key: string
  color: string
  count: number
}

interface DayRow {
  label: string
  segments: DaySegment[]
  total: number
  errorRate: number
  high: boolean
}

/**
 * Only non-zero segments are drawn — a zero-width div would still take the 3px
 * minimum below. No per-segment corner radius: the track clips them.
 *
 * Segments render in STATUS_CLASSES order, so a stacked bar always reads
 * success → client → server, left to right, and in the same colours the donut
 * beside it uses.
 */
function buildSegments(counts: Record<string, number>): DaySegment[] {
  return STATUS_CLASSES.filter((s) => counts[s.key] > 0).map((s) => ({
    key: s.key,
    color: s.color,
    count: counts[s.key],
  }))
}

const rows = computed<DayRow[]>(() =>
  props.history.map((p) => {
    const counts = {
      success: p.success,
      clientErrors: p.clientErrors,
      serverErrors: p.serverErrors,
    }
    const errors = counts.clientErrors + counts.serverErrors
    const total = counts.success + errors
    const errorRate = total > 0 ? errors / total : 0
    return {
      label: p.label,
      segments: buildSegments(counts),
      total,
      errorRate,
      high: errorRate >= threshold.value,
    }
  }),
)

// Pick a "nice" axis: three even ticks whose step comes from the 1/2/5
// sequence so the scale reads 0 / step / 2·step / 3·step (e.g. 0/1k/2k/3k).
function niceStep(x: number): number {
  if (x <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(x))
  const frac = x / pow
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10
  return nice * pow
}

const maxTotal = computed(() => Math.max(0, ...rows.value.map((r) => r.total)))
const step = computed(() => niceStep(Math.max(1, maxTotal.value) / 3))
const scale = computed(() => step.value * 3)
const ticks = computed(() => [0, step.value, 2 * step.value, 3 * step.value])

function pct(v: number): number {
  return scale.value > 0 ? (v / scale.value) * 100 : 0
}

function fmtTick(v: number): string {
  return v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(v)
}

function fmtPct(rate: number): string {
  return `${Math.round(rate * 100)}%`
}
</script>

<template>
  <div class="flex flex-col gap-3 px-3 py-2">
    <!-- per-day rows -->
    <div class="flex max-h-[320px] flex-col gap-3.5 overflow-y-auto pr-1">
      <div
        v-for="row in rows"
        :key="row.label"
        class="grid grid-cols-[2.75rem_1fr_3.5rem] items-center gap-3"
      >
        <span class="text-right font-mono text-xs text-dimmed">{{ row.label }}</span>

        <!-- track -->
        <div class="h-7 overflow-hidden rounded-md bg-elevated/40">
          <div class="flex h-full">
            <div
              v-for="segment in row.segments"
              :key="segment.key"
              class="h-full"
              :style="{
                width: `max(${pct(segment.count)}%, 3px)`,
                background: segment.color,
              }"
            />
          </div>
        </div>

        <!-- high-error badge gutter (always reserved so tracks stay aligned) -->
        <div class="flex justify-end">
          <UBadge v-if="row.high" color="warning" variant="subtle" size="sm">
            <UIcon name="i-ph-warning" class="size-3.5" />
            {{ fmtPct(row.errorRate) }}
          </UBadge>
        </div>
      </div>
    </div>

    <!-- x-axis -->
    <div class="grid grid-cols-[2.75rem_1fr_3.5rem] gap-3">
      <span />
      <div class="flex justify-between font-mono text-[10px] text-dimmed">
        <span v-for="t in ticks" :key="t">{{ fmtTick(t) }}</span>
      </div>
      <span />
    </div>

    <!-- legend -->
    <div
      class="flex flex-wrap items-center justify-center gap-4 pt-1 text-xs text-muted"
    >
      <span
        v-for="segment in STATUS_CLASSES"
        :key="segment.key"
        class="flex items-center gap-1.5"
      >
        <span
          class="size-2.5 rounded-full"
          :style="{ background: segment.color }"
        />
        {{ $t(segment.i18nKey) }}
      </span>
      <span class="flex items-center gap-1.5">
        <UIcon name="i-ph-warning" class="size-3.5 text-warning" />
        {{ $t('page.api.summary.breakdown.high_error_day') }}
      </span>
    </div>
  </div>
</template>
