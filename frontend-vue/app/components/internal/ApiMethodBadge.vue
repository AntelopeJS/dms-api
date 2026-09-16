<script setup lang="ts">
import { computed } from 'vue'
import { httpMethodColor } from '../../utils/httpMethod'

// HTTP-method badge. The DMS look is a flat, tinted, mono pill — in
// `@antelopejs/dms-frontend` that's `<UBadge variant="subtle">` with a
// per-verb semantic color. The verb → color mapping (the API-specific bit)
// lives in the shared `httpMethodColor` helper; the flat surface and its
// colors are inherited from the DMS theme.
const props = withDefaults(
  defineProps<{
    method: string
    size?: 'sm' | 'md' | 'lg'
  }>(),
  { size: 'sm' },
)

const upper = computed(() => props.method.toUpperCase())
const label = computed(() => (upper.value === '*' ? 'ALL' : upper.value))

const color = computed(() => httpMethodColor(upper.value))
</script>

<template>
  <UBadge
    :color="color"
    variant="subtle"
    :size="size"
    class="font-mono font-semibold tracking-wide"
  >
    {{ label }}
  </UBadge>
</template>
