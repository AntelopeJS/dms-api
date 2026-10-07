<script setup lang="ts">
// A list beside the item it selects: the children placed in the `aside` slot
// keep a fixed column on wide screens, the others take the rest and stack
// under it on narrow ones. A DMS Grid shares its columns equally.
defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{ asideWidth?: string }>(), { asideWidth: '340px' })
</script>

<template>
  <div
    class="grid grid-cols-1 items-start gap-4 lg:grid-cols-[var(--api-aside)_minmax(0,1fr)]"
    :style="{ '--api-aside': asideWidth }"
  >
    <div class="min-w-0 lg:sticky lg:top-4"><slot name="aside" /></div>
    <div class="flex min-w-0 flex-col gap-4"><slot /></div>
  </div>
</template>
