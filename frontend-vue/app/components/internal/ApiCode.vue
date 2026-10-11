<script setup lang="ts">
// A block of code or of a payload, in the mono font, with a copy button. Long
// lines wrap between words where they can, and the button keeps its corner
// clear of the text.
withDefaults(
  defineProps<{
    code: string
    label?: string
    maxHeight?: string
  }>(),
  { label: undefined, maxHeight: '22rem' },
)
</script>

<template>
  <div class="border-default bg-elevated/40 relative rounded-md border">
    <div
      v-if="label"
      class="border-default text-dimmed flex items-center justify-between border-b px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em]"
    >
      <span>{{ label }}</span>
      <DmsCopyButton :value="code" />
    </div>
    <DmsCopyButton v-else :value="code" class="absolute right-1.5 top-1.5" />
    <pre
      class="text-default overflow-auto whitespace-pre-wrap py-2.5 pl-3 font-mono text-[12px] leading-relaxed [overflow-wrap:anywhere]"
      :class="label ? 'pr-3' : 'pr-10'"
      :style="{ maxHeight }"
    ><code>{{ code }}</code></pre>
  </div>
</template>
