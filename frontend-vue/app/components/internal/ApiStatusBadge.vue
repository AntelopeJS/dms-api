<script setup lang="ts">
import { computed } from 'vue'
import { statusText, statusTone } from '../../utils/http'

/** A status code tinted by its class; with `text`, the reason phrase follows it. */
const props = withDefaults(
  defineProps<{
    status: number | string
    text?: boolean
    size?: 'sm' | 'md'
  }>(),
  { text: false, size: 'md' },
)

const code = computed(() => Number(props.status))
const label = computed(() => {
  if (!Number.isFinite(code.value) || code.value <= 0)
    return String(props.status)
  const phrase = props.text ? statusText(code.value) : ''
  return phrase ? `${code.value} ${phrase}` : String(code.value)
})
</script>

<template>
  <DmsStatusPill
    :tone="statusTone(status)"
    :label="label"
    :size="size"
    dot="none"
    mono
  />
</template>
