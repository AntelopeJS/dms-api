<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { PeriodKind } from '../../composables/useStatsPeriods'

/**
 * The period filter shared by the Overview, Routes and Logs pages.
 *
 * Owning the whole cycle here — read the retention, build the options, resolve
 * the starting window, persist every change — is what keeps the three pages
 * identical. They only see the resolved `Nd`/`Nh` value.
 *
 * `null` until the retention answers: pages hold off fetching rather than
 * request a window nobody picked, which would otherwise be a wasted round-trip
 * (or one past the retention) followed by a second for the real value.
 */
const props = withDefaults(
  defineProps<{
    /** Which retention bounds the list. */
    kind?: PeriodKind
    /** `?period=` deep link, when the page accepts one. */
    deepLink?: string
    size?: 'xs' | 'sm' | 'md'
    class?: string
  }>(),
  { kind: 'stats', size: 'sm', deepLink: undefined, class: undefined },
)

const model = defineModel<string | null>({ required: true })

const { options, load } = useStatsPeriods(props.kind)
const { resolve, set } = useSelectedPeriod()

const ready = ref(false)

onMounted(async () => {
  const fallback = await load()
  model.value = resolve(props.deepLink, options.value, fallback)
  ready.value = true
})

function onChange(value: string) {
  model.value = value
  set(value)
}
</script>

<template>
  <USelect
    v-if="ready"
    :model-value="model ?? undefined"
    :items="options"
    :size="size"
    :class="props.class"
    :aria-label="$t('page.api.filters.period')"
    @update:model-value="onChange"
  />
  <USkeleton v-else class="h-8 w-28" :class="props.class" />
</template>
