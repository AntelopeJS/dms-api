<script setup lang="ts">
import { computed } from 'vue'

// "Own routes · 42": the route scope every page of the console is filtered
// by, linking to where it is changed. The backend fills it per request.
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  scope?: 'own' | 'modules' | 'all'
  routes?: number
  to?: string
}>()

const { t } = useI18n()
const locale = useFormatLocale()

const label = computed(() =>
  t(`api.scope.${props.scope ?? 'own'}`, {
    count: new Intl.NumberFormat(locale.value).format(props.routes ?? 0),
  }),
)
</script>

<template>
  <UTooltip :text="t('api.scope.tooltip')">
    <UButton
      :to="to"
      :label="label"
      icon="i-ph-funnel"
      color="neutral"
      variant="outline"
      size="sm"
      class="font-mono text-xs"
    />
  </UTooltip>
</template>
