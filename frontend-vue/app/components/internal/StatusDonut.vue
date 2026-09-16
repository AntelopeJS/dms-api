<script setup lang="ts">
import { computed } from 'vue'

// Status-breakdown donut (DMS apiv2-overview): a flat conic-gradient ring with
// a masked centre (total + "responses") and a column legend (dot + name +
// value + percent) to its right. Built by hand to match the maquette exactly —
// ApexCharts' donut renders a different ring/legend layout.
interface DonutSegment {
  label: string
  value: number
  color: string
}

const props = defineProps<{
  segments: DonutSegment[]
  total: number
  centerSubLabel: string
}>()

const ring = computed(() => {
  if (props.total <= 0) return 'transparent'
  let acc = 0
  const stops = props.segments.map((s) => {
    const from = (acc / props.total) * 100
    acc += s.value
    const to = (acc / props.total) * 100
    return `${s.color} ${from.toFixed(2)}% ${to.toFixed(2)}%`
  })
  return `conic-gradient(${stops.join(',')})`
})

function fmtCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function pct(value: number): string {
  return props.total > 0 ? `${((value / props.total) * 100).toFixed(1)}%` : '0%'
}
</script>

<template>
  <div class="flex flex-col items-center gap-7 px-2 py-2 pb-4 sm:flex-row sm:gap-7">
    <!-- ring -->
    <div class="relative size-[168px] shrink-0">
      <div
        class="absolute inset-0 rounded-full"
        :style="{
          background: ring,
          '-webkit-mask': 'radial-gradient(circle, transparent 56%, #000 57%)',
          mask: 'radial-gradient(circle, transparent 56%, #000 57%)',
        }"
      />
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-center">
        <b class="text-2xl font-semibold leading-none text-highlighted">
          {{ fmtCount(total) }}
        </b>
        <small class="font-mono text-[10px] uppercase tracking-widest text-dimmed">
          {{ centerSubLabel }}
        </small>
      </div>
    </div>

    <!-- legend -->
    <div class="flex w-full flex-1 flex-col gap-3">
      <div
        v-for="s in segments"
        :key="s.label"
        class="flex items-center gap-3"
      >
        <span
          class="size-[11px] shrink-0 rounded-[3px]"
          :style="{ background: s.color }"
        />
        <span class="flex-1 text-[13px] text-muted">{{ s.label }}</span>
        <span class="font-mono text-[13px] font-semibold text-highlighted">
          {{ fmtCount(s.value) }}
        </span>
        <span class="min-w-[46px] text-right font-mono text-[11px] text-dimmed">
          {{ pct(s.value) }}
        </span>
      </div>
    </div>
  </div>
</template>
