<script setup lang="ts">
import { computed, ref, watch } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  id?: string
  min?: number
  max?: number
  step?: number
  disabled?: boolean
}>()
const model = defineModel<number | null | undefined>()

const { t } = useI18n()
const { formatLocale, formatNumber } = useRegionalFormat({ locale: 'format' })

const adjustment = ref<InputNumberAdjustment | null>(null)

watch(model, (value) => {
  if (value !== adjustment.value?.value) adjustment.value = null
})

const adjustmentText = computed(() => {
  const current = adjustment.value
  if (!current) return ''
  return t(`api.settings.number.adjusted_${current.reason}`, {
    typed: formatNumber(current.typed),
    value: formatNumber(current.value),
    step: formatNumber(props.step ?? 1),
  })
})
</script>

<template>
  <div class="grid gap-1.5">
    <DmsInputNumber
      :id="props.id"
      v-model="model"
      :min="props.min"
      :max="props.max"
      :step="props.step"
      :locale="formatLocale"
      :disabled="props.disabled"
      class="w-40"
      @adjust="adjustment = $event"
    />
    <p
      v-if="adjustmentText"
      class="text-muted flex items-start gap-1.5 text-xs"
      role="status"
    >
      <UIcon name="i-ph-info" class="mt-px size-3.5 shrink-0" />
      <span>{{ adjustmentText }}</span>
    </p>
  </div>
</template>
