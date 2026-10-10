<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatCount } from '../../utils/format'

// The shape of the last hour above the request table: requests per minute by
// status class, refreshed while Live is on. A poll that fails says so and
// retries, instead of a "Live" badge over a dead stream.
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  fetchUrl: string
  pageId?: string
  componentId?: string
}>()

interface LiveBucket {
  start: number
  success: number
  clientErrors: number
  serverErrors: number
}

interface LivePayload {
  buckets: LiveBucket[]
  total: number
  clientErrors: number
  serverErrors: number
  refreshedAt: string
  retentionDays: number
  maxBodyKb: number
}

const POLL_MS = 5_000
const RETRY_MS = 10_000
const FAILURES_BEFORE_PAUSE = 3

const { t } = useI18n()
const locale = useFormatLocale()
const { data, error, pending, refresh } = useApiResource<LivePayload>(
  () => props.fetchUrl,
)

const live = ref(true)
const failures = ref(0)
let timer: ReturnType<typeof setTimeout> | undefined

function schedule() {
  clearTimeout(timer)
  if (!live.value) return
  const paused = failures.value >= FAILURES_BEFORE_PAUSE
  timer = setTimeout(poll, paused ? RETRY_MS : POLL_MS)
}

async function poll() {
  await refresh()
  failures.value = error.value ? failures.value + 1 : 0
  schedule()
}

function toggleLive() {
  live.value = !live.value
}

watch(live, (on) => {
  if (on) {
    failures.value = 0
    void poll()
  } else clearTimeout(timer)
})

function onKey(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"]'))
    return
  if (
    event.key.toLowerCase() === 'l' &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    toggleLive()
  }
}

onMounted(() => {
  schedule()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  clearTimeout(timer)
  window.removeEventListener('keydown', onKey)
})

// Filters another page linked here with (`?route=`, `?error=`, `?slow=`):
// the table applies them without a chip of its own, so they are named here,
// each with a way out.
const LINK_FILTERS = ['route', 'error', 'slow'] as const
const currentRoute = useDmsRoute()
const router = useDmsRouter()
const linkFilters = computed(() =>
  LINK_FILTERS.filter(
    (key) =>
      typeof currentRoute.query[key] === 'string' && currentRoute.query[key],
  ).map((key) => ({ key, value: currentRoute.query[key] as string })),
)

function clearFilter(key?: string) {
  const query: Record<string, string> = { ...currentRoute.query }
  for (const name of key ? [key] : LINK_FILTERS) delete query[name]
  void router.push({ query })
}

const paused = computed(
  () => live.value && failures.value >= FAILURES_BEFORE_PAUSE,
)

const series = computed(() => {
  const buckets = data.value?.buckets ?? []
  const points = (pick: (bucket: LiveBucket) => number) =>
    buckets.map((bucket) => ({ x: bucket.start, y: pick(bucket) }))
  return [
    { name: '2xx', data: points((bucket) => bucket.success) },
    { name: '4xx', data: points((bucket) => bucket.clientErrors) },
    { name: '5xx', data: points((bucket) => bucket.serverErrors) },
  ]
})

const count = (value: number) => formatCount(value, locale.value)
</script>

<template>
  <DmsCard :padded="false" class="overflow-hidden">
    <template #header>
      <div class="flex w-full flex-wrap items-center gap-3">
        <DmsEyebrow :label="t('api.live.title')" />
        <span class="text-dimmed font-mono text-[11px]">
          {{
            data
              ? t('api.live.kept', {
                  days: data.retentionDays,
                  kb: count(data.maxBodyKb),
                })
              : ''
          }}
        </span>
        <span class="grow" />
        <span v-if="data" class="text-muted font-mono text-[11px]">
          {{ t('api.live.total', { count: count(data.total) }, data.total) }}
          <span v-if="data.clientErrors" class="text-warning">
            · 4xx {{ count(data.clientErrors) }}
          </span>
          <span v-if="data.serverErrors" class="text-error">
            · 5xx {{ count(data.serverErrors) }}
          </span>
        </span>
        <UTooltip :text="t('api.live.shortcut')">
          <UButton
            size="xs"
            :color="live && !paused ? 'success' : 'neutral'"
            :variant="live ? 'soft' : 'outline'"
            :icon="
              live
                ? paused
                  ? 'i-ph-pause-circle'
                  : 'i-ph-broadcast'
                : 'i-ph-play'
            "
            :label="
              live
                ? paused
                  ? t('api.live.paused')
                  : t('api.live.on')
                : t('api.live.off')
            "
            :aria-pressed="live"
            @click="toggleLive"
          />
        </UTooltip>
      </div>
    </template>

    <div class="px-3 pb-2 pt-1">
      <div v-if="pending" class="flex h-[96px] items-end gap-[3px] px-2">
        <USkeleton
          v-for="index in 60"
          :key="index"
          class="flex-1"
          :style="{ height: `${20 + ((index * 37) % 60)}%` }"
        />
      </div>
      <DmsChart
        :page-id="pageId ?? ''"
        :component-id="`${componentId ?? 'api'}-chart`"
        v-else-if="data"
        type="column"
        height="96px"
        :static-dataset="series"
        :color="['--dms-chart-1', 'warning', 'error']"
        stacked
        :show-legend="false"
        :show-grid="false"
        xaxis-type="datetime"
        :rounded-corners="false"
        :column-width="70"
      />
      <DmsEmptyState
        v-else
        size="sm"
        variant="error"
        :title="t('api.live.error')"
        :actions="[{ label: t('api.common.retry'), onClick: () => poll() }]"
      />
    </div>

    <div
      v-if="linkFilters.length"
      class="border-default flex flex-wrap items-center gap-2 border-t px-4 py-2.5 text-[12.5px]"
    >
      <span class="text-muted">{{ t('api.live.filtered') }}</span>
      <UBadge
        v-for="filter in linkFilters"
        :key="filter.key"
        color="primary"
        variant="soft"
        class="max-w-[28rem] gap-1.5 font-mono"
      >
        <span class="truncate">
          {{ t(`api.live.filter_${filter.key}`, { value: filter.value }) }}
        </span>
        <button
          type="button"
          class="hover:text-highlighted"
          :aria-label="t('api.live.remove_filter')"
          @click="clearFilter(filter.key)"
        >
          <UIcon name="i-ph-x" class="size-3" />
        </button>
      </UBadge>
      <UButton
        size="xs"
        color="neutral"
        variant="link"
        :label="t('api.live.clear_filters')"
        @click="clearFilter()"
      />
    </div>

    <DmsBanner
      v-if="paused"
      tone="warning"
      size="sm"
      icon="i-ph-cloud-warning"
      class="mx-3 mb-3"
      :title="t('api.live.paused_title')"
      :description="
        t('api.live.paused_description', { seconds: RETRY_MS / 1000 })
      "
    >
      <template #actions>
        <UButton
          size="xs"
          color="neutral"
          variant="outline"
          :label="t('api.live.resume')"
          @click="poll()"
        />
      </template>
    </DmsBanner>
  </DmsCard>
</template>
