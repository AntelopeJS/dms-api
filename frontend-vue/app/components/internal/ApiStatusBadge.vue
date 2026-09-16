<script setup lang="ts">
import { computed } from 'vue'

// HTTP status-code badge. Flat DMS look via `<UBadge variant="subtle">`; this
// wrapper owns the status-class → color mapping. 2xx→success, 3xx→info,
// 4xx→warning, 5xx→error (0 / network error → error).
const props = withDefaults(
  defineProps<{
    status: number
    size?: 'sm' | 'md' | 'lg'
  }>(),
  { size: 'sm' },
)

const color = computed<'success' | 'info' | 'warning' | 'error'>(() => {
  if (!props.status) return 'error'
  if (props.status >= 500) return 'error'
  if (props.status >= 400) return 'warning'
  if (props.status >= 300) return 'info'
  return 'success'
})
</script>

<template>
  <UBadge :color="color" variant="subtle" :size="size" class="font-mono tabular-nums">
    {{ status || 'ERR' }}
  </UBadge>
</template>
