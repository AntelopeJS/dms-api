<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useControlError } from '#dms-ui/app/build/composables/form/useControlError'
import {
  type NumberAdjustment,
  numberAdjustment,
  parseTypedNumber,
  revealLinkedField,
} from '../../utils/settingsForm'

// A number of the Settings form (a retention, the body cap, the slow
// threshold). The field keeps a typed value within its bounds and on its
// steps when it is left: 1020 typed for steps of 50 becomes 1,000. It then
// shows the value it holds, never the one typed, and says why it changed;
// an emptied field is an error, since the save would store something else.
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
const locale = useFormatLocale()
const { report } = useControlError()
const root = useTemplateRef<HTMLElement>('root')

const formatNumber = (value: number) =>
  new Intl.NumberFormat(locale.value).format(value)

// What was typed since the field last settled, and how the field changed it.
let typed: string | null = null
const adjustment = ref<{
  reason: NumberAdjustment
  typed: number
  value: number
} | null>(null)
// The number field keeps its own copy of the text typed, which it does not
// always redraw when the value it settles on is the one it already held
// (1020 typed over 1,000): drawn again, it shows the value held.
const renderKey = ref(0)

function onInput(event: Event): void {
  typed = (event.target as HTMLInputElement).value
  adjustment.value = null
}

/** Once the field applied the typed text (on leaving it, or on Enter). */
async function settle(event: Event): Promise<void> {
  if (typed === null) return
  const text = typed
  typed = null
  await nextTick()
  const value = parseTypedNumber(text, locale.value)
  const reason = numberAdjustment(value, model.value, props)
  if (!reason || value === null || typeof model.value !== 'number') return
  adjustment.value = { reason, typed: value, value: model.value }
  renderKey.value += 1
  if (event.type !== 'keydown') return
  await nextTick()
  root.value?.querySelector('input')?.focus()
}

const adjustmentText = computed(() => {
  const current = adjustment.value
  if (!current) return ''
  return t(`api.settings.number.adjusted_${current.reason}`, {
    typed: formatNumber(current.typed),
    value: formatNumber(current.value),
    step: formatNumber(props.step ?? 1),
  })
})

watch(model, (value, previous) => {
  if (adjustment.value && value !== adjustment.value.value)
    adjustment.value = null
  if (typeof value === 'number') report(undefined)
  else if (typeof previous === 'number')
    report(t('api.settings.number.required'))
})

onMounted(() => revealLinkedField(props.id, root.value))
</script>

<template>
  <div
    ref="root"
    class="grid gap-1.5"
    @input="onInput"
    @focusout="settle"
    @keydown.enter="settle"
  >
    <UInputNumber
      :id="props.id"
      :key="renderKey"
      v-model="model"
      :min="props.min"
      :max="props.max"
      :step="props.step"
      :locale="locale"
      :disabled="props.disabled"
      orientation="vertical"
      :increment="{ color: 'neutral' }"
      :decrement="{ color: 'neutral' }"
      class="w-40"
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
