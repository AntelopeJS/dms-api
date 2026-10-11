<script setup lang="ts">
// The toolbar of the monitoring pages, the same on each: the route scope (and
// the Beta pill on the Overview) on the left, the Live / Pause control and
// the period on the right. Each side keeps together: in a narrow window the
// right one moves to a line of its own, under the scope, rather than being
// squeezed over it, and wraps within itself on the narrowest screens.
defineOptions({ inheritAttrs: false })
</script>

<template>
  <div class="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
    <div class="flex min-w-0 max-w-full items-center gap-3">
      <slot name="scope" />
      <slot name="badge" />
    </div>
    <div
      class="ms-auto flex max-w-full flex-wrap items-center justify-end gap-x-3 gap-y-2"
    >
      <slot name="live" />
      <slot name="period" />
    </div>
  </div>
</template>
