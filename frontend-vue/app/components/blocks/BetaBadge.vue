<script setup lang="ts">
defineOptions({ inheritAttrs: false })

const { t } = useI18n()
</script>

<template>
  <UTooltip :text="t('api.overview.beta.description')">
    <UBadge
      color="info"
      variant="soft"
      size="sm"
      tabindex="0"
      :label="t('api.overview.beta.title')"
      :aria-label="`${t('api.overview.beta.title')} · ${t('api.overview.beta.description')}`"
    />
  </UTooltip>
</template>
