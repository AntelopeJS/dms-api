<script setup lang="ts">
import { formatMs } from '../../utils/format'

// A request's duration in a table cell. A request rejected before reaching
// a handler has none measured: a dash says so, not "0 ms".
defineProps<{
  ms: number | null | undefined
  slow?: boolean
}>()

const { t } = useI18n()
const locale = useFormatLocale()
</script>

<template>
  <span
    v-if="ms === null || ms === undefined"
    class="text-dimmed font-mono text-xs"
    :title="t('api.request.not_measured_hint')"
  >
    —
    <span class="sr-only">{{ t('api.request.not_measured_hint') }}</span>
  </span>
  <span
    v-else
    class="font-mono text-xs tabular-nums"
    :class="slow ? 'text-warning font-semibold' : 'text-default'"
  >
    {{ formatMs(ms, locale) }}
    <span v-if="slow" class="sr-only">· {{ t('api.request.slow') }}</span>
  </span>
</template>
