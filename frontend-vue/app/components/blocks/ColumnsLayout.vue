<script setup lang="ts">
import { computed, h, useId, type FunctionalComponent } from 'vue'
import { columnsStylesheet } from '../../utils/columns'

// Cards side by side that wrap by halves: four KPIs read 4, then 2 × 2, then
// one per line, and two charts sit side by side only when each keeps room to
// be read. A DMS Grid drops one column at a time instead, which leaves three
// cards and an orphan at the most common laptop width.
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{ columns?: number; minColumnWidth?: string; gap?: string }>(),
  { columns: 2, minColumnWidth: '240px', gap: '1rem' },
)

const scope = `api-columns-${useId().replace(/[^\w-]/g, '_')}`
const css = computed(() =>
  columnsStylesheet(scope, props.columns, props.minColumnWidth, props.gap),
)

// A render function: the server escapes interpolated text, and a <style>
// element does not decode entities.
const Stylesheet: FunctionalComponent<{ css: string }> = (stylesheet) =>
  h('style', { innerHTML: stylesheet.css })
Stylesheet.props = ['css']
</script>

<template>
  <div
    class="min-w-0"
    :style="{ containerType: 'inline-size', containerName: scope }"
  >
    <div class="grid *:min-w-0" :style="{ gap }" :data-api-columns="scope">
      <slot />
    </div>
    <Stylesheet :css="css" />
  </div>
</template>
