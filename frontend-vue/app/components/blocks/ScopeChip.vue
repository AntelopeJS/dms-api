<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onMounted } from 'vue'

defineOptions({ inheritAttrs: false })

type Scope = 'own' | 'modules' | 'all'

const props = defineProps<{
  scope?: Scope
  routes?: number
  to?: string
  fetchUrl?: string
  /** The live feed (`LIVE_REQUESTS_TOPIC`), whose missed 5xx it counts. */
  realtimeTopic?: string
}>()

const { t } = useI18n()
const { formatNumber } = useRegionalFormat({ locale: 'format' })
const summary = useApiData<{ scope: Scope; routes: number }>(
  () => props.fetchUrl,
  { refreshOnPageRefresh: false },
)

const scope = computed(() => summary.data.value?.scope ?? props.scope ?? 'own')
const routes = computed(() => summary.data.value?.routes ?? props.routes ?? 0)

const label = computed(() =>
  t(`api.scope.${scope.value}`, {
    count: formatNumber(routes.value),
  }),
)

/**
 * A refresh of the page's blocks reads the scope again, once a minute at
 * most: it changes on the Settings page, not with traffic.
 */
const REFRESH_INTERVAL_MS = 60_000

let lastAskedAt = Date.now()

function read() {
  lastAskedAt = Date.now()
  void summary.refresh()
}

function refreshIfStale() {
  if (Date.now() - lastAskedAt >= REFRESH_INTERVAL_MS) read()
}

usePageLiveRefresh(refreshIfStale)
if (props.realtimeTopic) useLiveMissedErrors(props.realtimeTopic)

function refreshWhenShown() {
  if (document.visibilityState === 'visible') read()
}

let activated = false
onActivated(() => {
  if (activated) read()
  activated = true
})

onMounted(() => document.addEventListener('visibilitychange', refreshWhenShown))
onBeforeUnmount(() =>
  document.removeEventListener('visibilitychange', refreshWhenShown),
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
