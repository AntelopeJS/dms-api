<script setup lang="ts">
import { onMounted, useTemplateRef } from 'vue'
import { revealLinkedField } from '../../utils/settingsForm'

// A list of names of the Settings form (the captured headers): the DMS tags
// input, which a link to the field (`…/settings#requestLogCaptureHeaders`,
// from a request's headers) brings into view and focuses. The DMS form only
// follows the anchor of a section.
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  id?: string
  max?: number
  suggestions?: string[]
  placeholder?: string
  disabled?: boolean
}>()
const model = defineModel<string[] | null | undefined>()

const root = useTemplateRef<HTMLElement>('root')

onMounted(() => revealLinkedField(props.id, root.value))
</script>

<template>
  <div ref="root">
    <DmsInputTags
      :id="props.id"
      v-model="model"
      :max="props.max"
      :suggestions="props.suggestions"
      :placeholder="props.placeholder"
      :disabled="props.disabled"
    />
  </div>
</template>
