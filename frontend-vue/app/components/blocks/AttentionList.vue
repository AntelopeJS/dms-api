<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  durationParts,
  formatAgo,
  formatCount,
  formatFullDateTime,
  formatMs,
  formatPercent,
  formatRelativeDay,
  spanPart,
} from '../../utils/format'

// "Needs attention": the routes the health rules flag, worst first, each
// saying what is wrong in the reader's words and linking to the requests
// that show it. The server sends numbers; the figures are written here, in
// the reader's locale, and the top error keeps two lines and a tooltip
// instead of being cut. A DMS ActivityFeed could do neither.
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  fetchUrl: string
  /** Where "All server errors" leads. */
  errorsLink: string
}>()

type AttentionState = 'failing' | 'recovered' | 'slow' | 'client-errors'

/** Rates in percent (0–100), durations in ms. */
interface AttentionItem {
  id: string
  route: string
  /** A route the API registers; false for a path none answers. */
  known?: boolean
  state: AttentionState
  to?: string
  /** When the incident started, or when it ended for a recovered route. */
  date?: string
  metrics: {
    calls: number
    serverErrors: number
    clientErrors: number
    serverErrorRate: number
    clientErrorRate: number
    averageMs: number
    p95Ms: number | null
    maxMs: number
  }
  /**
   * What the health rule that set a failing or recovered state reads now,
   * over its own window (15 min, 5 min when down); null for the others.
   */
  stateWindow: {
    minutes: number
    requests: number
    serverErrors: number
    serverErrorRate: number
  } | null
  topError: { status: number; message: string | null; count: number } | null
  /** When the incident started, and when the verdict came back. */
  incident?: { start: string | null; end: string | null } | null
  /** The route's last 5xx, for a failing or recovered one. */
  lastServerError?: string | null
}

interface AttentionPayload {
  items: AttentionItem[]
  /** Every route needing attention, more than `items` when capped. */
  total: number
  healthWindow: { minutes: number }
}

/** The most rows "Show all" asks for (the endpoint's own cap). */
const ALL_ROWS = 100
const MS_PER_MINUTE = 60_000

const LOOK: Record<AttentionState, { icon: string; tone: string }> = {
  failing: { icon: 'i-ph-x-circle', tone: 'text-error bg-error/10' },
  recovered: {
    icon: 'i-ph-arrow-counter-clockwise',
    tone: 'text-success bg-success/10',
  },
  slow: { icon: 'i-ph-timer', tone: 'text-warning bg-warning/10' },
  'client-errors': { icon: 'i-ph-warning', tone: 'text-warning bg-warning/10' },
}

const { t } = useI18n()
const locale = useFormatLocale()

const expanded = ref(false)
const { data, error, pending, refresh } = useApiResource<AttentionPayload>(
  () =>
    expanded.value ? `${props.fetchUrl}?limit=${ALL_ROWS}` : props.fetchUrl,
)

// Live, the list is read again; never while the pointer is on it, where a
// row moving would take the click: the refresh waits for it to leave.
const hovered = ref(false)
let deferred = false
useLiveRefresh(() => {
  if (hovered.value) deferred = true
  else void refresh()
})
function leave() {
  hovered.value = false
  if (deferred) {
    deferred = false
    void refresh()
  }
}

const count = (value: number) => formatCount(value, locale.value)
const ms = (value: number) => formatMs(value, locale.value)

const stale = computed(() => !!error.value && !!data.value)

const span = computed(() => {
  const minutes = data.value?.healthWindow.minutes
  if (!minutes) return ''
  const { amount, unit } = spanPart(minutes * MS_PER_MINUTE)
  return t('api.overview.last', {
    span: t(`api.health.duration.${unit}`, { n: count(amount) }),
  })
})

const hidden = computed(() =>
  data.value ? data.value.total - data.value.items.length : 0,
)

// The paths no route answers (a scanner's `GET /.env`, `/wp-login.php`)
// fold into one row after the routes, opened on demand: four of them would
// otherwise read as four problems of the API.
const strayOpen = ref(false)
const stray = computed(
  () => data.value?.items.filter((item) => item.known === false) ?? [],
)
type Row =
  | { kind: 'item'; key: string; item: AttentionItem }
  | { kind: 'stray'; key: string }
const rows = computed<Row[]>(() => {
  const items = data.value?.items ?? []
  const row = (item: AttentionItem): Row => ({
    kind: 'item',
    key: item.id,
    item,
  })
  const known = items.filter((item) => item.known !== false).map(row)
  if (stray.value.length === 0) return known
  return [
    ...known,
    { kind: 'stray', key: 'stray' },
    ...(strayOpen.value ? stray.value.map(row) : []),
  ]
})

function label(item: AttentionItem): string {
  return t(`api.overview.attention.${item.state.replace('-', '_')}`)
}

/** The day's 5xx of a failing or recovered route, after its verdict's window. */
function lookback(item: AttentionItem): string {
  const { metrics } = item
  return t('api.overview.attention.lookback_detail', {
    span: span.value,
    rate: formatPercent(metrics.serverErrorRate, locale.value),
    serverErrors: count(metrics.serverErrors),
    calls: count(metrics.calls),
  })
}

/** "2 h 5 min": how long, in its two largest units. */
function duration(ms: number): string {
  return durationParts(ms)
    .map(({ amount, unit }) =>
      t(`api.health.duration.${unit}`, { n: count(amount) }),
    )
    .join(' ')
}

/**
 * A recovered route: since when, and its last 5xx. The rate of its state
 * window would still hold the burst (the window reaches back to 20 calls on
 * a route called rarely): "Recovered · 94 % server errors" reads as failing.
 */
function recoveredDetail(item: AttentionItem): string | null {
  const last = item.lastServerError
  if (!last) return null
  const time = formatRelativeDay(last, locale.value)
  const end = item.incident?.end
  return end
    ? t('api.overview.attention.recovered_detail', {
        span: duration(Date.now() - new Date(end).getTime()),
        time,
      })
    : t('api.overview.attention.recovered_last', { time })
}

function detail(item: AttentionItem): string {
  const { metrics } = item
  const calls = metrics.calls
  switch (item.state) {
    case 'recovered':
      return recoveredDetail(item) ?? failingDetail(item)
    case 'failing':
      return failingDetail(item)
    case 'client-errors':
      return t(
        'api.overview.attention.client_errors_detail',
        {
          rate: formatPercent(metrics.clientErrorRate, locale.value),
          clientErrors: count(metrics.clientErrors),
          calls: count(calls),
        },
        calls,
      )
    default:
      return t(
        'api.overview.attention.slow_detail',
        {
          p95: metrics.p95Ms === null ? '—' : ms(metrics.p95Ms),
          average: ms(metrics.averageMs),
          calls: count(calls),
        },
        calls,
      )
  }
}

/**
 * A failing route (or a recovered one without its last 5xx): its rate, the
 * one its state rests on first, over its rule's window.
 */
function failingDetail(item: AttentionItem): string {
  const { metrics, stateWindow } = item
  if (stateWindow) {
    return t(
      'api.overview.attention.window_detail',
      {
        rate: formatPercent(stateWindow.serverErrorRate, locale.value),
        minutes: stateWindow.minutes,
        serverErrors: count(stateWindow.serverErrors),
        calls: count(stateWindow.requests),
      },
      stateWindow.requests,
    )
  }
  return t(
    'api.overview.attention.failing_detail',
    {
      rate: formatPercent(metrics.serverErrorRate, locale.value),
      serverErrors: count(metrics.serverErrors),
      calls: count(metrics.calls),
    },
    metrics.calls,
  )
}

function topError(item: AttentionItem): string {
  const top = item.topError
  if (!top) return ''
  return top.message
    ? t('api.overview.attention.top_error', {
        status: top.status,
        message: top.message,
        count: count(top.count),
      })
    : t('api.overview.attention.top_status', {
        status: top.status,
        count: count(top.count),
      })
}

function ago(item: AttentionItem): string {
  const elapsed = formatAgo(item.date)
  if (!elapsed) return ''
  return t(`api.common.ago_${elapsed.unit}`, { amount: count(elapsed.amount) })
}
</script>

<template>
  <DmsCard
    :padded="false"
    class="flex h-full min-w-0 flex-col overflow-hidden"
    @mouseenter="hovered = true"
    @mouseleave="leave"
  >
    <DmsSectionHeader
      size="card"
      as="h2"
      class="border-default border-b py-3.5 pl-[18px] pr-4"
      :title="t('api.overview.attention.title')"
      :count="data && data.total > 0 ? count(data.total) : undefined"
    >
      <template #trailing>
        <UBadge v-if="span" color="neutral" variant="soft" size="sm">
          {{ span }}
        </UBadge>
        <UButton
          :to="errorsLink"
          color="neutral"
          variant="ghost"
          size="xs"
          :label="t('api.overview.attention.all_errors')"
        />
      </template>
    </DmsSectionHeader>

    <div v-if="pending" class="divide-(--ui-border-muted) divide-y py-1">
      <div
        v-for="row in 3"
        :key="row"
        class="flex items-center gap-3 px-[18px] py-3"
      >
        <USkeleton class="size-[30px] shrink-0 rounded-lg" />
        <div class="grid flex-1 gap-1.5">
          <USkeleton class="h-3 w-3/5" />
          <USkeleton class="h-2.5 w-2/5" />
        </div>
      </div>
    </div>

    <DmsEmptyState
      v-else-if="!data"
      variant="error"
      size="sm"
      :title="t('api.overview.attention.error_title')"
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
      v-else-if="data.items.length === 0"
      icon="i-ph-check-circle"
      size="sm"
      class="min-h-40 place-content-center"
      :title="t('api.overview.attention.empty_title')"
      :description="t('api.overview.attention.empty_description', { span })"
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
      <!-- Every row of the first page shows, without a scroll of its own
           that would hide the last ones; only the whole list, once asked
           for, scrolls within the card. -->
      <ul
        class="divide-(--ui-border-muted) min-h-0 flex-1 divide-y py-1 transition-opacity [scrollbar-width:thin]"
        :class="[
          stale && 'opacity-55',
          expanded && 'max-h-[40rem] overflow-y-auto',
        ]"
      >
        <template v-for="row in rows" :key="row.key">
          <li v-if="row.kind === 'stray'">
            <button
              type="button"
              class="hover:bg-elevated/60 focus-visible:outline-primary flex w-full items-center gap-3 px-[18px] py-2.5 text-start focus-visible:outline-2 focus-visible:-outline-offset-2"
              :aria-expanded="strayOpen"
              @click="strayOpen = !strayOpen"
            >
              <span
                class="bg-elevated text-muted grid size-[30px] shrink-0 place-items-center rounded-lg"
              >
                <UIcon
                  name="i-ph-question"
                  class="size-[15px]"
                  aria-hidden="true"
                />
              </span>
              <span class="grid min-w-0 flex-1 gap-0.5">
                <span class="text-toned text-[12.5px]">
                  {{
                    t(
                      'api.overview.attention.stray_title',
                      { count: count(stray.length) },
                      stray.length,
                    )
                  }}
                </span>
                <span class="text-dimmed text-xs">
                  {{ t('api.overview.attention.stray_hint') }}
                </span>
              </span>
              <UIcon
                :name="strayOpen ? 'i-ph-caret-up' : 'i-ph-caret-down'"
                class="text-dimmed size-4 shrink-0"
                aria-hidden="true"
              />
            </button>
          </li>
          <li v-else>
            <ULink
              :to="row.item.to"
              raw
              class="hover:bg-elevated/60 focus-visible:outline-primary flex items-start gap-3 px-[18px] py-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2"
            >
              <span
                class="mt-0.5 grid size-[30px] shrink-0 place-items-center rounded-lg"
                :class="LOOK[row.item.state].tone"
              >
                <UIcon
                  :name="LOOK[row.item.state].icon"
                  class="size-[15px]"
                  aria-hidden="true"
                />
              </span>
              <span class="grid min-w-0 flex-1 gap-0.5">
                <span class="flex min-w-0 items-baseline gap-2">
                  <span
                    class="text-toned min-w-0 flex-1 truncate font-mono text-[12.5px]"
                    :title="row.item.route"
                  >
                    {{ row.item.route }}
                  </span>
                  <time
                    v-if="row.item.date"
                    :datetime="row.item.date"
                    :title="formatFullDateTime(row.item.date, locale)"
                    class="text-dimmed shrink-0 text-xs"
                  >
                    {{ ago(row.item) }}
                  </time>
                </span>
                <span class="text-muted text-xs">
                  <b class="font-medium">{{ label(row.item) }}</b>
                  · {{ detail(row.item) }}
                </span>
                <span v-if="row.item.stateWindow" class="text-dimmed text-xs">
                  {{ lookback(row.item) }}
                </span>
                <span
                  v-if="row.item.topError"
                  class="text-dimmed line-clamp-2 break-words font-mono text-[11.5px]"
                  :title="topError(row.item)"
                >
                  {{ topError(row.item) }}
                </span>
              </span>
            </ULink>
          </li>
        </template>
      </ul>
      <div
        v-if="hidden > 0 || expanded"
        class="border-default border-t px-[18px] py-2"
      >
        <UButton
          color="neutral"
          variant="link"
          size="xs"
          class="px-0"
          :label="
            expanded
              ? t('api.overview.attention.show_less')
              : t('api.overview.attention.show_all', {
                  count: count(data.total),
                })
          "
          @click="expanded = !expanded"
        />
      </div>
    </template>
  </DmsCard>
</template>
