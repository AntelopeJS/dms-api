<script setup lang="ts">
import { computed } from 'vue'

// A list beside the item it selects: the children placed in the `aside` slot
// keep a fixed column on wide screens, the others take the rest and stack
// under it on narrow ones. A DMS Grid shares its columns equally. The
// children of the `route` slot need a route that exists: they wait, hidden,
// while the URL names none or one the runtime does not register, and the
// header says why.
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{ asideWidth?: string; detailUrl?: string; queryKey?: string }>(),
  { asideWidth: '340px', detailUrl: undefined, queryKey: 'route' },
)

const detail = props.detailUrl
  ? useRouteDetail(props.detailUrl, props.queryKey)
  : null
const routeReady = computed(
  () => !!detail?.selection.ref.value && !detail.missing.value,
)
</script>

<template>
  <div
    class="grid grid-cols-1 items-start gap-4 lg:grid-cols-[var(--api-aside)_minmax(0,1fr)]"
    :style="{ '--api-aside': asideWidth }"
  >
    <div class="min-w-0 lg:sticky lg:top-4"><slot name="aside" /></div>
    <div class="flex min-w-0 flex-col gap-4">
      <slot />
      <slot v-if="routeReady" name="route" />
    </div>
  </div>
</template>
