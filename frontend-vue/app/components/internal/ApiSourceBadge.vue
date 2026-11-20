<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ source: 'tester' | 'automation' }>()

const { t } = useI18n()

const badge = computed(() =>
  props.source === 'automation'
    ? {
        icon: 'i-ph-robot',
        label: t('api.request.automation'),
        title: t('api.request.source_automation'),
      }
    : {
        icon: 'i-ph-paper-plane-tilt',
        label: t('api.request.tester'),
        title: t('api.request.source_tester'),
      },
)
</script>

<template>
  <UBadge
    size="sm"
    color="info"
    variant="subtle"
    :icon="badge.icon"
    :label="badge.label"
    :title="badge.title"
    class="shrink-0"
  />
</template>
