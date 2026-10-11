<script setup lang="ts">
import {
  computed,
  h,
  inject,
  onBeforeUnmount,
  onMounted,
  ref,
  resolveComponent,
  useTemplateRef,
  watch,
} from 'vue'
import SettingNumberInput from './SettingNumberInput.vue'
import {
  createRetentionGuard,
  isLowered,
  type RetentionChange,
  type RetentionGuard,
  type RetentionImpact,
  retentionChoices,
  retentionGuardOf,
} from '../../utils/settingsForm'

// A retention of the Settings form, in days: a few choices (statistics) or a
// number (request logs). Lowering it deletes the data older than the new
// value at the next hourly prune, so a lowered value says what it deletes,
// and the save asks to confirm it first (one dialog for both fields).
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
const locale = useFormatLocale()
const { confirm } = useConfirm()
const root = useTemplateRef<HTMLElement>('root')
// The app's registered UIcon, for the dialog's render function: importing
// `@nuxt/ui/components/Icon.vue` would reach its Nuxt build, which the
// dependency optimizer cannot bundle (`#imports`).
const UIcon = resolveComponent('UIcon')

const formatNumber = (value: number) =>
  new Intl.NumberFormat(locale.value).format(value)

const items = computed(() =>
  retentionChoices(props.choices ?? [], props.initialValue).map((days) => ({
    value: days,
    label: t('api.settings.retention.days', { count: days }, days),
    description: choiceDescription(days),
  })),
)

function choiceDescription(days: number): string {
  if (!props.choices?.includes(days))
    return t('api.settings.retention.choice_current')
  if (days === props.defaultChoice)
    return t('api.settings.retention.choice_default')
  return days > PREVIOUS_PERIOD_DAYS
    ? t('api.settings.retention.choice_comparison')
    : t('api.settings.retention.choice_no_comparison')
}

const lowered = computed(() => isLowered(model.value, props.initialValue))

// The impact follows the value once it settles: not on every keystroke.
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
  impactDays.value == null
    ? null
    : `${props.impactUrl}?${new URLSearchParams({
        field: props.id ?? '',
        days: String(impactDays.value),
      })}`,
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
    impact: impact.value ?? null,
  }
}

/**
 * The lowered retentions as the dialog lists them: the change, then what it
 * deletes on a line of its own. The dialog is narrow (420 px, fixed by the
 * DMS): side by side, both wrapped onto two lines each.
 */
function confirmList(changes: RetentionChange[]) {
  return h(
    'ul',
    {
      class:
        'border-default divide-default divide-y overflow-hidden rounded-md border bg-(--dms-bg-muted)',
    },
    changes.map((change) =>
      h('li', { key: change.field, class: 'flex gap-2.5 px-3 py-2' }, [
        h(UIcon, {
          name: 'i-ph-trash',
          class: 'text-dimmed mt-0.5 size-4 shrink-0',
          'aria-hidden': 'true',
        }),
        h('div', { class: 'grid min-w-0 gap-0.5' }, [
          h('span', { class: 'text-default text-[13px]' }, change.label),
          change.impact
            ? h(
                'span',
                { class: 'text-highlighted font-mono text-xs font-semibold' },
                t('api.settings.retention.confirm_requests', {
                  requests: formatNumber(change.impact.requests),
                }),
              )
            : null,
        ]),
      ]),
    ),
  )
}

/** One dialog for every lowered retention of the form. */
function askToConfirm(changes: RetentionChange[]): Promise<boolean> {
  return confirm({
    title: t('api.settings.retention.confirm_title'),
    description: t('api.settings.retention.confirm_description'),
    color: 'error',
    confirmLabel: t('api.settings.retention.confirm_save'),
    initialFocus: 'cancel',
    body: () => confirmList(changes),
  })
}

let guard: RetentionGuard | undefined

watch([model, impact, () => props.initialValue], () => {
  if (props.id) guard?.set(props.id, pendingChange())
})

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
    <URadioGroup
      v-if="props.choices?.length"
      :id="props.id"
      v-model="model"
      :items="items"
      :disabled="props.disabled"
      :aria-label="t(`api.settings.retention.${props.kind}`)"
      variant="card"
      orientation="horizontal"
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
