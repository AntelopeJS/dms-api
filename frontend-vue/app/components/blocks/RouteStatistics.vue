<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  appendPeriodToUrl,
  usePeriodScope,
} from '#dms-core/app/composables/period/usePeriodScope'

// The Statistics tab of a route: its cards while the route has traffic over
// the page's period, else one useful line instead of a page of zeros — when
// it was last called, and the tester to call it now.
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    /**
     * The route's figures over a period, as the DMS StatGroup of the tab
     * reads them: its `requests` cell holds the call count.
     */
    summaryUrl: string
    detailUrl: string
    periodScope?: string
    queryKey?: string
    /** Query key and value of the tab holding the tester. */
    tabKey?: string
    testerTab?: string
  }>(),
  {
    periodScope: undefined,
    queryKey: 'route',
    tabKey: 'tab',
    testerTab: '2',
  },
)

const { t } = useI18n()
const locale = useFormatLocale()
const page = useDmsRoute()
const router = useDmsRouter()
const period = usePeriodScope(props.periodScope)
const { selection, data: route } = useRouteDetail(
  props.detailUrl,
  props.queryKey,
)
const traffic = useApiResource<{
  items: { id?: string; value: unknown }[]
}>(() => {
  const current = selection.ref.value
  if (!current || !period.value) return null
  return appendPeriodToUrl(
    `${props.summaryUrl}?${new URLSearchParams({ route: current })}`,
    period.value,
  )
})

// Held between two answers: a relative period slides every minute, and the
// cards must not blink in and out while the count is fetched again.
const idle = ref(false)

// Live, an idle route is watched for its first call. Once the cards show,
// their StatGroup reads the same figures on each refresh: reading them here
// too sent them twice a tick. The period sliding still reads it again, which
// is when a route turns idle.
useLiveRefresh(() => {
  if (idle.value) void traffic.refresh()
})
watch(selection.ref, () => (idle.value = false))
watch(traffic.data, (payload) => {
  const calls = payload?.items.find((item) => item.id === 'requests')?.value
  if (typeof calls === 'number') idle.value = calls === 0
})

const lastCall = computed(() => {
  const at = route.value?.lastCallAt
  if (at === undefined) return undefined
  if (at === null) return t('api.routes.statistics.idle_never')
  return t('api.routes.statistics.idle_last', {
    date: new Intl.DateTimeFormat(locale.value, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(at)),
  })
})

function openTester() {
  void router.push({
    query: { ...liveQuery(page), [props.tabKey]: props.testerTab },
  })
}
</script>

<template>
  <DmsCard v-if="idle" :padded="false" class="px-5 py-8">
    <DmsEmptyState
      icon="i-ph-moon-stars"
      :title="t('api.routes.statistics.idle_title')"
      :description="lastCall"
      :actions="[
        {
          label: t('api.routes.statistics.idle_try'),
          icon: 'i-ph-paper-plane-tilt',
          onClick: openTester,
        },
      ]"
    />
  </DmsCard>
  <div v-else class="flex min-w-0 flex-col gap-4"><slot /></div>
</template>
