<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <UBadge
    size="sm"
    color="info"
    variant="subtle"
    icon="i-ph-paper-plane-tilt"
    :label="t('api.request.tester')"
    :title="t('api.request.source_tester')"
    class="shrink-0"
  />
</template>
