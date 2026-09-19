<script setup lang="ts">
import { computed } from 'vue'

/**
 * Area chart whose values carry a unit (e.g. "7.52 ms").
 *
 * <DmsChart> has no unit/suffix option: the only formatter it wires into
 * ApexCharts comes from a parent <DmsChartCard>'s `valueFormat`, whose formats
 * are number / currency / percent / compact — none of which can express a
 * duration. Its `rawOptions` escape hatch is JSON-parsed, so a formatter
 * function cannot be passed through it either.
 *
 * So this renders through the same two pieces <DmsChart> itself uses —
 * `useApexChart` for the themed options and <DmsApexChartHost> for the canvas —
 * and supplies the one field <DmsChart> never sets, `yAxisFormatter`. That
 * formatter drives both the y-axis labels and the tooltip values, so the unit
 * shows up in both.
 */
interface Series {
  name: string
  data: Array<{ x: string; y: number }>
  color: string
}

const props = withDefaults(
  defineProps<{
    series: Series[]
    unit: string
    colors: string[]
    height?: string
  }>(),
  { height: '240px' },
)

const themeRevision = useThemeRevision()
const { locale } = useI18n()

// Intl so the decimal separator follows the admin's locale, like every other
// number the DMS renders.
const format = computed(() => {
  const nf = new Intl.NumberFormat(locale.value)
  return (value: number) => `${nf.format(value)} ${props.unit}`
})

const apex = useApexChart(() => ({
  type: 'area',
  height: props.height,
  smooth: true,
  showLegend: true,
  series: props.series,
  colors: props.colors,
  themeRevision: themeRevision.value,
  yAxisFormatter: format.value,
}))
</script>

<template>
  <!-- Same frame classes <DmsChart> puts on a standalone chart, so a card
       holding one of each renders the two identically. -->
  <div class="dms-chart dms-card p-5 sm:p-6">
    <DmsClientOnly>
      <DmsApexChartHost
        :apex-type="apex.apexType.value"
        :height="height"
        :options="apex.options.value"
        :series="apex.series.value"
      />
      <template #fallback>
        <USkeleton class="w-full" :style="{ height }" />
      </template>
    </DmsClientOnly>
  </div>
</template>
