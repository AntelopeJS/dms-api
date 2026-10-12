<script setup lang="ts">
import {
  computed,
  inject,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from 'vue'
import {
  createRetentionGuard,
  isLowered,
  type RetentionChange,
  type RetentionGuard,
  type RetentionImpact,
  retentionGuardOf,
} from '../../utils/settingsForm'
import SettingNumberInput from './SettingNumberInput.vue'

// A retention of the Settings form, in days: a few choices (statistics) or a
// number (request logs, `SettingNumberInput`), drawn by the DMS inputs. Lowering it deletes the
// data older than the new value at the next hourly prune, so a lowered value
// says what it deletes, and the save asks to confirm it first (one dialog for
// both fields), the DMS form having no confirmation of its own on submit.
defineOptions({ inheritAttrs: false })

type RetentionKind = 'logs' | 'statistics'

const props = defineProps<{
  id?: string
  kind: RetentionKind
  impactUrl: string
  /** The values offered, as cards; a number input without them. */
  choices?: number[]
  defaultChoice?: number
  min?: number
  max?: number
  disabled?: boolean
  /** The value saved: what a lower value is compared with. */
  initialValue?: number | null
}>()
const model = defineModel<number | null | undefined>()

const IMPACT_DEBOUNCE_MS = 300
const PREVIOUS_PERIOD_DAYS = 30

const { t } = useI18n()
const { confirm } = useConfirm()
const { $authFetch } = useAuthFetch()
const root = useTemplateRef<HTMLElement>('root')

const regional = useRegionalFormat()
const formatNumber = (value: number) => String(regional.formatNumber(value))

const items = computed(() =>
  (props.choices ?? []).map((days) => ({
    value: days,
    label: t('api.settings.retention.days', { count: days }, days),
    description: choiceDescription(days),
  })),
)

function choiceDescription(days: number): string {
  if (days === props.defaultChoice)
    return t('api.settings.retention.choice_default')
  return days > PREVIOUS_PERIOD_DAYS
    ? t('api.settings.retention.choice_comparison')
    : t('api.settings.retention.choice_no_comparison')
}

const lowered = computed(() => isLowered(model.value, props.initialValue))

function impactUrlOf(field: string, days: number): string {
  return `${props.impactUrl}?${new URLSearchParams({
    field,
    days: String(days),
  })}`
}

// The impact under the field follows the value once it settles: not on
// every keystroke.
const impactDays = ref<number | null>(null)
let impactTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => (lowered.value ? model.value : null),
  (days) => {
    clearTimeout(impactTimer)
    if (days == null) {
      impactDays.value = null
      return
    }
    impactTimer = setTimeout(() => {
      impactDays.value = days
    }, IMPACT_DEBOUNCE_MS)
  },
  { immediate: true },
)
onBeforeUnmount(() => clearTimeout(impactTimer))

const impactResource = useApiResource<RetentionImpact>(() =>
  impactDays.value == null || !props.id
    ? null
    : impactUrlOf(props.id, impactDays.value),
)
const impact = computed(() =>
  lowered.value && impactDays.value === model.value
    ? impactResource.data.value
    : null,
)

const impactText = computed(() => {
  if (!lowered.value) return ''
  const value = impact.value
  if (!value) return t('api.settings.retention.impact_pending')
  if (value.requests === 0)
    return t(
      'api.settings.retention.impact_none',
      { days: formatNumber(model.value as number) },
      model.value as number,
    )
  return t(
    `api.settings.retention.impact_${props.kind}`,
    {
      days: formatNumber(value.days),
      requests: formatNumber(value.requests),
    },
    value.days,
  )
})

/** The lowered value, as the save's confirmation lists it; null if not. */
function pendingChange(): RetentionChange | null {
  if (!props.id || !isLowered(model.value, props.initialValue)) return null
  return {
    field: props.id,
    label: t(
      'api.settings.retention.confirm_change',
      {
        field: t(`api.settings.retention.${props.kind}_name`),
        from: formatNumber(props.initialValue as number),
        to: formatNumber(model.value),
      },
      model.value,
    ),
    from: props.initialValue as number,
    to: model.value,
  }
}

/**
 * What a change deletes, read when the dialog opens: a save sent right after
 * the change, before the field's own count came back, still says it.
 */
async function deletedRequests(change: RetentionChange) {
  try {
    const read = await $authFetch<RetentionImpact>(
      impactUrlOf(change.field, change.to),
    )
    return t('api.settings.retention.confirm_requests', {
      requests: formatNumber(read.requests),
    })
  } catch {
    return undefined
  }
}

/** One dialog for every lowered retention of the form, with what each deletes. */
async function askToConfirm(changes: RetentionChange[]): Promise<boolean> {
  const counts = await Promise.all(changes.map(deletedRequests))
  return confirm({
    title: t('api.settings.retention.confirm_title'),
    description: t('api.settings.retention.confirm_description'),
    color: 'error',
    confirmLabel: t('api.settings.retention.confirm_save'),
    initialFocus: 'cancel',
    impact: changes.map((change, index) => ({
      icon: 'i-ph-trash',
      label: change.label,
      count: counts[index],
    })),
  })
}

let guard: RetentionGuard | undefined

watch([model, () => props.initialValue], () => {
  if (props.id) guard?.set(props.id, pendingChange())
})

// The DMS form has no way to submit again from a field: the guard of the
// form element the field sits in submits it once the dialog is confirmed.
onMounted(() => {
  const form = root.value?.closest('form')
  if (!form || !props.id) return
  guard = retentionGuardOf(form, () =>
    createRetentionGuard(askToConfirm, () => form.requestSubmit()),
  )
  guard.set(props.id, pendingChange())
})
onBeforeUnmount(() => {
  if (props.id) guard?.set(props.id, null)
})

const registerValidator = inject(FORM_VALIDATOR_KEY, null)
if (registerValidator) {
  const unregister = registerValidator(() => guard?.allowSubmit() ?? true)
  onBeforeUnmount(unregister)
}
</script>

<template>
  <div ref="root" class="grid gap-2">
    <DmsChoiceCards
      v-if="props.choices?.length"
      :id="props.id"
      v-model="model"
      :items="items"
      :columns="items.length"
      :disabled="props.disabled"
    />
    <SettingNumberInput
      v-else
      :id="props.id"
      v-model="model"
      :min="props.min"
      :max="props.max"
      :step="1"
      :disabled="props.disabled"
    />
    <p
      v-if="lowered"
      class="text-error flex items-start gap-1.5 text-xs"
      role="status"
    >
      <UIcon name="i-ph-warning" class="mt-px size-3.5 shrink-0" />
      <span>{{ impactText }}</span>
    </p>
  </div>
</template>
