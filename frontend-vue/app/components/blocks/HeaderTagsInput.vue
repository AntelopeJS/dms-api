<script setup lang="ts">
import { computed, inject, onMounted, ref, useTemplateRef, watch } from 'vue'
import {
  formErrorsInjectionKey,
  formFieldInjectionKey,
} from '@nuxt/ui/composables/useFormField'
import { useControlError } from '#dms-ui/app/build/composables/form/useControlError'
import {
  addHeaderNames,
  invalidHeaderNames,
  revealLinkedField,
} from '../../utils/settingsForm'

// The captured headers of the Settings form, as tags. Each name is stored in
// lower case as it is added, so the form shows what is saved. A name HTTP
// does not allow, or one the capture never stores (`authorization`, asked
// to the server as names are added, by the rule the save applies), shows red
// and is the field's error: the save stops before anything is sent, and the
// form's summary names the field. A name the server refused on save shows
// red the same way.
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  id?: string
  max?: number
  /** Offered as the user types. */
  suggestions?: string[]
  placeholder?: string
  disabled?: boolean
  /** Answers which of `?names=` the capture never stores. */
  sensitiveUrl?: string
}>()
const model = defineModel<string[] | null | undefined>()

/** A form error naming some of the items (`values`), as the form keeps it. */
interface ItemsError {
  name?: string
  values?: unknown
}

// Commas, semicolons and whitespace end a name, typed or pasted.
const DELIMITER = /[\s,;]+/

const { t } = useI18n()
const { processI18n } = useTranslation()
const { report } = useControlError()
const formField = inject(formFieldInjectionKey, undefined)
const formErrors = inject(formErrorsInjectionKey, undefined)

const tags = computed(() => model.value ?? [])
const isFull = computed(
  () => props.max !== undefined && tags.value.length >= props.max,
)
const suggestionsId = computed(() => `${props.id ?? 'headers'}-suggestions`)

const invalid = computed(() => new Set(invalidHeaderNames(tags.value)))

// The names asked about follow the list; the answer on screen stays until
// the next one arrives, so a red tag does not blink as another is added.
const sensitiveCheck = useApiResource<{ sensitive: string[] }>(() => {
  const names = tags.value.filter((name) => !invalid.value.has(name))
  return props.sensitiveUrl && names.length
    ? `${props.sensitiveUrl}?${new URLSearchParams({ names: names.join(',') })}`
    : null
})
const sensitiveAnswer = ref<string[]>([])
watch(
  () => sensitiveCheck.data.value,
  (answer) => {
    if (answer) sensitiveAnswer.value = answer.sensitive
  },
)
const sensitive = computed(
  () =>
    new Set(sensitiveAnswer.value.filter((name) => tags.value.includes(name))),
)

const refused = computed(() => {
  const name = formField?.value?.name
  const error = (formErrors?.value as ItemsError[] | undefined)?.find(
    (entry) => entry.name === name,
  )
  return new Set(Array.isArray(error?.values) ? error.values.map(String) : [])
})

function isFlagged(item: string): boolean {
  return (
    invalid.value.has(item) ||
    sensitive.value.has(item) ||
    refused.value.has(item)
  )
}

/** The field's error: the names HTTP does not allow, then the secret ones. */
const error = computed(() => {
  for (const [names, key] of [
    [invalid.value, 'api.settings.capture.invalid_headers'],
    [sensitive.value, 'api.settings.capture.sensitive_headers'],
  ] as const) {
    const list = [...names]
    if (list.length) return t(key, { value: list.join(', ') }, list.length)
  }
  return undefined
})
watch(error, (message) => report(message), { immediate: true })

// The message under the field, which a red tag points to.
const errorId = computed(() =>
  formField?.value?.ariaId ? `${formField.value.ariaId}-error` : undefined,
)

const root = useTemplateRef<HTMLElement>('root')
onMounted(() => revealLinkedField(props.id, root.value))

function onTags(next: string[] | null | undefined): void {
  model.value = addHeaderNames([], next ?? [], props.max)
}
</script>

<template>
  <div ref="root">
    <UInputTags
      :id="props.id"
      :model-value="tags"
      :placeholder="
        isFull || !props.placeholder
          ? undefined
          : processI18n(props.placeholder)
      "
      :disabled="props.disabled"
      :max="props.max"
      :delimiter="DELIMITER"
      :list="props.suggestions?.length ? suggestionsId : undefined"
      add-on-paste
      add-on-blur
      add-on-tab
      class="w-full"
      :ui="{
        item: 'has-[[data-flagged]]:border-error/50 has-[[data-flagged]]:bg-error/10 has-[[data-flagged]]:text-error',
      }"
      @update:model-value="onTags"
    >
      <template #item-text="{ item }">
        <!-- The tag and its delete button are named by this text: a red
          one reads as invalid, and points to the field's message. -->
        <span
          class="inline-flex items-center gap-1 font-mono"
          :data-flagged="isFlagged(String(item)) || undefined"
          :aria-invalid="isFlagged(String(item)) || undefined"
          :aria-describedby="isFlagged(String(item)) ? errorId : undefined"
        >
          <UIcon
            v-if="isFlagged(String(item))"
            name="i-ph-warning-circle"
            class="size-3.5 shrink-0"
          />
          {{ item }}
          <span v-if="isFlagged(String(item))" class="sr-only">
            {{ t('api.settings.capture.tag_invalid') }}
          </span>
        </span>
      </template>
    </UInputTags>
    <datalist v-if="props.suggestions?.length" :id="suggestionsId">
      <option
        v-for="suggestion in props.suggestions"
        :key="suggestion"
        :value="suggestion"
      />
    </datalist>
  </div>
</template>
