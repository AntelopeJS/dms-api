<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { formatCount, formatMs, formatPercent } from '../../utils/format'
import {
  PERIOD_WINDOWS,
  WINDOW_PRESETS,
  WINDOW_QUERY_KEY,
} from '../../utils/periodWindow'

// A top list of the Overview over the page's period: "Responses by class"
// (`classes`) or "Slowest routes" (`slowest`). The server sends numbers; the
// value, its unit and the line under it are written here in the reader's
// locale, which a DMS TopListCard, showing a server-made description, cannot.
// A new period empties the list until its figures arrive, so figures never
// sit under a period they do not belong to; a failed refresh says so.
defineOptions({ inheritAttrs: false })

type ListKind = 'classes' | 'slowest'

const props = defineProps<{
  kind: ListKind
  fetchUrl: string
  /** The period scope the page's `PeriodWindow` drives. */
  periodScope: string
}>()

interface ClassItem {
  id: string
  statusClass: '2xx' | '4xx' | '5xx'
  value: number
  /** Share of the window's calls, in percent. */
  share: number
  to?: string
}

interface SlowItem {
  id: string
  route: string
  averageMs: number
  p95Ms: number | null
  /**
   * Share of the calls the p95 is measured on (0–1): the latency histogram
   * is missing on the oldest days. Below 1 the p95 is partial; at 0, none.
   */
  p95Coverage?: number
  maxMs: number
  requests: number
  to?: string
}

type ListItem = ClassItem | SlowItem

interface ListPayload {
  items: ListItem[]
}

interface Row {
  id: string
  title: string
  mono: boolean
  value: string
  sub: string
  /** Tooltip of the line under the title: what a partial figure means. */
  subTitle?: string
  /** Width of the proportion bar, in percent of the largest value. */
  bar: number
  barTone: string
  to?: string
}

const CLASS_BAR: Record<ClassItem['statusClass'], string> = {
  '2xx': 'bg-success',
  '4xx': 'bg-warning',
  '5xx': 'bg-error',
}

const SKELETON_ROWS: Record<ListKind, number> = { classes: 3, slowest: 5 }
const PERCENT = 100

const { t } = useI18n()
const locale = useFormatLocale()

const scope = usePeriodScope(props.periodScope)

// The window the scope follows, by its preset: one address per period, so a
// rolling preset re-resolving every minute does not refetch the list.
const period = computed(() =>
  PERIOD_WINDOWS.find((value) => WINDOW_PRESETS[value] === scope.value?.preset),
)

const { data, error, pending, refresh } = useApiResource<ListPayload>(() =>
  period.value ? `${props.fetchUrl}?${WINDOW_QUERY_KEY}=${period.value}` : null,
)
useLiveRefresh(() => void refresh())

// No period yet: the scope registers in the browser once the page mounts.
const loading = computed(() => pending.value || !period.value)
const stale = computed(() => !!error.value && !!data.value)
const count = (value: number) => formatCount(value, locale.value)

// The period scope registers in the browser only: the badge waits for the
// mount, so the server render and the first browser one draw the same.
const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})
const badge = computed(() =>
  mounted.value && period.value
    ? t(`dms.period.presets.${WINDOW_PRESETS[period.value]}`)
    : '',
)

function classRow(item: ClassItem, largest: number): Row {
  return {
    id: item.id,
    title: t(`api.overview.classes.${item.statusClass}`),
    mono: false,
    value: count(item.value),
    sub: t('api.overview.classes.share', {
      share: formatPercent(item.share, locale.value),
    }),
    bar: largest > 0 ? (item.value / largest) * PERCENT : 0,
    barTone: CLASS_BAR[item.statusClass],
    to: item.to,
  }
}

/**
 * "p95 · max · calls": the p95 only where it was measured, said partial
 * (with why, in the tooltip) when some days of the period have no histogram.
 */
function slowDetail(item: SlowItem): Pick<Row, 'sub' | 'subTitle'> {
  const coverage = item.p95Ms === null ? 0 : (item.p95Coverage ?? 1)
  const max = formatMs(item.maxMs, locale.value)
  const calls = count(item.requests)
  if (item.p95Ms === null || coverage <= 0) {
    return {
      sub: t(
        'api.overview.slowest.detail_no_p95',
        { max, calls },
        item.requests,
      ),
      subTitle: t('api.overview.slowest.p95_missing'),
    }
  }
  const p95 = formatMs(item.p95Ms, locale.value)
  if (coverage >= 1) {
    return {
      sub: t('api.overview.slowest.detail', { p95, max, calls }, item.requests),
    }
  }
  return {
    sub: t(
      'api.overview.slowest.detail_partial',
      { p95, max, calls },
      item.requests,
    ),
    subTitle: t('api.overview.slowest.p95_partial', {
      share: formatPercent(coverage * PERCENT, locale.value),
    }),
  }
}

function slowRow(item: SlowItem, largest: number): Row {
  return {
    id: item.id,
    title: item.route,
    mono: true,
    value: formatMs(item.averageMs, locale.value),
    ...slowDetail(item),
    bar: largest > 0 ? (item.averageMs / largest) * PERCENT : 0,
    barTone: 'bg-primary',
    to: item.to,
  }
}

const rows = computed<Row[]>(() => {
  const items = data.value?.items ?? []
  if (props.kind === 'classes') {
    const classes = items as ClassItem[]
    const largest = Math.max(0, ...classes.map((item) => item.value))
    return classes.map((item) => classRow(item, largest))
  }
  const routes = items as SlowItem[]
  const largest = Math.max(0, ...routes.map((item) => item.averageMs))
  return routes.map((item) => slowRow(item, largest))
})
</script>

<template>
  <DmsCard :padded="false" class="flex h-full min-w-0 flex-col overflow-hidden">
    <DmsSectionHeader
      size="card"
      as="h2"
      class="border-default border-b py-3.5 pl-[18px] pr-4"
      :title="t(`api.overview.${kind}.title`)"
      :description="t(`api.overview.${kind}.description`)"
    >
      <template #trailing>
        <UBadge v-if="badge" color="primary" variant="soft" size="sm">
          {{ badge }}
        </UBadge>
        <USkeleton v-else class="h-5 w-16 rounded-[5px]" aria-hidden="true" />
      </template>
    </DmsSectionHeader>

    <div
      v-if="loading"
      class="divide-(--ui-border-muted) divide-y py-1"
      aria-busy="true"
    >
      <div
        v-for="row in SKELETON_ROWS[kind]"
        :key="row"
        class="grid gap-1.5 px-[18px] py-3"
      >
        <div class="flex justify-between gap-3">
          <USkeleton class="h-3 w-2/5" />
          <USkeleton class="h-3 w-12" />
        </div>
        <USkeleton class="h-2.5 w-1/4" />
      </div>
    </div>

    <DmsEmptyState
      v-else-if="!data"
      variant="error"
      size="sm"
      :title="t('api.overview.list_error')"
      :actions="[
        {
          label: t('api.common.retry'),
          icon: 'i-ph-arrow-clockwise',
          color: 'neutral',
          variant: 'outline',
          onClick: () => refresh(),
        },
      ]"
    />

    <DmsEmptyState
      v-else-if="rows.length === 0"
      icon="i-ph-rows"
      size="sm"
      class="min-h-40 place-content-center"
      :title="t(`api.overview.${kind}.empty`)"
    />

    <template v-else>
      <DmsBanner
        v-if="stale"
        tone="warning"
        size="sm"
        class="m-3 mb-0"
        :title="t('api.common.stale')"
      >
        <template #actions>
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            :label="t('api.common.retry')"
            @click="refresh()"
          />
        </template>
      </DmsBanner>
      <ul
        class="divide-(--ui-border-muted) divide-y py-1 transition-opacity"
        :class="stale && 'opacity-55'"
      >
        <li v-for="row in rows" :key="row.id">
          <ULink
            :to="row.to"
            raw
            class="hover:bg-elevated/60 focus-visible:outline-primary grid gap-1 px-[18px] py-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2"
          >
            <span class="flex min-w-0 items-baseline gap-3">
              <span
                class="text-highlighted min-w-0 flex-1 truncate"
                :class="row.mono ? 'font-mono text-[12.5px]' : 'text-sm'"
                :title="row.title"
              >
                {{ row.title }}
              </span>
              <span
                class="text-highlighted shrink-0 font-mono text-sm font-semibold tabular-nums"
              >
                {{ row.value }}
              </span>
            </span>
            <span class="text-dimmed text-xs" :title="row.subTitle">
              {{ row.sub }}
            </span>
            <span
              class="bg-muted block h-[3px] overflow-hidden rounded-full"
              aria-hidden="true"
            >
              <span
                class="block h-full rounded-full"
                :class="row.barTone"
                :style="{ width: `${row.bar}%` }"
              />
            </span>
          </ULink>
        </li>
      </ul>
    </template>
  </DmsCard>
</template>
