<script setup lang="ts">
// A request id in a table cell: its first characters, which tell requests
// apart, with the whole id on hover and in the copy.
defineProps<{ id: string }>()

/** Characters of the id the cell shows. */
const SHORT_LENGTH = 8
</script>

<template>
  <span
    class="group/id inline-flex min-w-0 items-center gap-0.5"
    @dblclick.stop
  >
    <span class="text-toned font-mono text-[12px]" :title="id">
      {{ id.slice(0, SHORT_LENGTH) }}
    </span>
    <DmsCopyButton
      :value="id"
      class="opacity-0 transition-opacity focus-visible:opacity-100 group-hover/id:opacity-100"
    />
  </span>
</template>
