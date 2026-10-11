<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { formatThreshold } from '../../utils/format'
import {
  ALL_LOG_WINDOW,
  DEFAULT_LOG_WINDOW,
  hasIncident,
  isRouteRef,
  LINK_FILTER_KEYS,
  LOG_METHODS,
  readLogsFilters,
  routeMethod,
  withLogsFilters,
  type LogsFiltersPatch,
} from '../../utils/logsQuery'
import {
  readStoredWindow,
  sessionWindowStorage,
} from '../../utils/periodWindow'
import { localDay } from '../../utils/requestDrawer'

// The filters bar right above the request table: the method, the slow
// requests, every period kept, and the filters a link brought (route, path,
// error, an incident's range), each removable.
// Everything here reads and writes the URL (`utils/logsQuery.ts`), as the
// period does: the table follows the URL, so what the bar shows is what
// the table lists, and the tab counts with it.
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  /** The slowness threshold of Settings, in ms: what "slow" means. */
  slowThresholdMs?: number
}>()

const { t } = useI18n()
const locale = useFormatLocale()
const route = useDmsRoute()
const router = useDmsRouter()

const filters = computed(() => readLogsFilters(route.query))

function apply(patch: LogsFiltersPatch) {
  void router.push({ query: withLogsFilters(route.query, patch) })
}

// A route filter fixes the method: the control shows it, and is off.
const methodLocked = computed(
  () => !!filters.value.route && isRouteRef(filters.value.route),
)
const method = computed(() =>
  methodLocked.value ? routeMethod(filters.value.route) : filters.value.method,
)

// One method at a time: plain items, the chosen one checked, and the menu
// closes on a choice (checkbox items would keep it open, as for several).
function methodItem(label: string, value: string | null) {
  const chosen = (filters.value.method ?? null) === value
  return {
    label,
    chosen,
    onSelect: () => apply({ method: value }),
  }
}
const methodItems = computed(() => [
  [methodItem(t('api.logs.filters.all_methods'), null)],
  LOG_METHODS.map((value) => methodItem(value, value)),
])

const slowLabel = computed(() =>
  props.slowThresholdMs === undefined
    ? t('api.logs.filters.slow')
    : t('api.logs.filters.slow_threshold', {
        threshold: formatThreshold(props.slowThresholdMs, locale.value),
      }),
)

// Every request kept, whatever its age: past the toolbar's presets, which
// hold the module's common period. Off again, the period kept for the tab.
const allPeriods = computed(() => filters.value.window === ALL_LOG_WINDOW)
function toggleAllPeriods() {
  apply({
    window: allPeriods.value
      ? (readStoredWindow(sessionWindowStorage()) ?? DEFAULT_LOG_WINDOW)
      : ALL_LOG_WINDOW,
  })
}

/** "18:31", with the day in front once it is not today. */
function incidentTime(iso: string): string {
  const date = new Date(iso)
  const time = date.toLocaleTimeString(locale.value, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  if (localDay(date) === localDay(new Date())) return time
  const day = date.toLocaleDateString(locale.value, {
    month: 'short',
    day: 'numeric',
  })
  return `${day}, ${time}`
}

interface Chip {
  key: string
  label: string
  /** A filter the table cannot apply: said, not passed off as one. */
  invalid?: boolean
  remove: LogsFiltersPatch
}

// A route as the module names it, without the trailing slash an older link
// carries; one that names no route at all says so.
function linkChip(key: (typeof LINK_FILTER_KEYS)[number], value: string): Chip {
  if (key === 'route' && !isRouteRef(value))
    return {
      key,
      label: t('api.logs.linked.route_unknown', { value }),
      invalid: true,
      remove: { route: null },
    }
  return {
    key,
    label: t(`api.logs.linked.${key}`, {
      value: value,
    }),
    remove: { [key]: null } as LogsFiltersPatch,
  }
}

const chips = computed<Chip[]>(() => {
  const current = filters.value
  const list = LINK_FILTER_KEYS.filter((key) => !!current[key]).map((key) =>
    linkChip(key, current[key]!),
  )
  if (hasIncident(current))
    list.push({
      key: 'incident',
      label: t('api.logs.linked.incident', {
        since: current.since ? incidentTime(current.since) : '…',
        until: current.until ? incidentTime(current.until) : '…',
      }),
      remove: { incident: null },
    })
  return list
})

// "Last 24 hours · from Overview": where the link came from, and the period
// it brought while it is still the page's. An incident's range frames the
// rows instead of the period: its chip says it.
const origin = computed(() => {
  const { from, window } = filters.value
  if (!from) return undefined
  const page = t(`api.logs.linked.pages.${from}`)
  return window && !hasIncident(filters.value)
    ? t('api.logs.linked.origin_window', {
        window: t(`api.logs.windows.${window}`),
        page,
      })
    : t('api.logs.linked.origin', { page })
})

const shortcutsOpen = ref(false)

const SHORTCUTS = [
  { keys: ['/'], label: 'api.logs.shortcuts.search' },
  { keys: ['J', 'K'], label: 'api.logs.shortcuts.step' },
  { keys: ['Esc'], label: 'api.logs.shortcuts.close' },
  { keys: ['L'], label: 'api.logs.shortcuts.live' },
  { keys: ['?'], label: 'api.logs.shortcuts.help' },
]

// "/" opens the table's search: the DMS table opens it on Shift+F, the key
// it listens to on the window.
function openSearch() {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'F', code: 'KeyF', shiftKey: true }),
  )
}

function onKey(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"]'))
    return
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (event.key === '/') {
    event.preventDefault()
    openSearch()
  } else if (event.key === '?') {
    event.preventDefault()
    shortcutsOpen.value = true
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 text-[12.5px]">
    <UTooltip
      :text="
        methodLocked
          ? t('api.logs.filters.method_locked', {
              route: filters.route ?? '',
            })
          : undefined
      "
      :disabled="!methodLocked"
    >
      <span>
        <UDropdownMenu :items="methodItems" :disabled="methodLocked">
          <template #item-trailing="{ item }">
            <UIcon
              v-if="item.chosen"
              name="i-ph-check"
              class="text-primary size-4 shrink-0"
            />
          </template>
          <UButton
            size="sm"
            icon="i-ph-funnel"
            trailing-icon="i-ph-caret-down"
            :color="method ? 'primary' : 'neutral'"
            :variant="method ? 'soft' : 'outline'"
            :disabled="methodLocked"
            :label="
              method
                ? t('api.logs.filters.method_value', { method })
                : t('api.logs.filters.method')
            "
            :aria-label="
              t('api.logs.filters.method_aria', {
                value: method ?? t('api.logs.filters.all_methods'),
              })
            "
          />
        </UDropdownMenu>
      </span>
    </UTooltip>

    <UTooltip :text="t('api.logs.filters.slow_hint')">
      <UButton
        size="sm"
        icon="i-ph-timer"
        :color="filters.slow ? 'primary' : 'neutral'"
        :variant="filters.slow ? 'soft' : 'outline'"
        :label="slowLabel"
        :aria-pressed="filters.slow"
        @click="apply({ slow: !filters.slow })"
      />
    </UTooltip>

    <UTooltip :text="t('api.logs.filters.all_periods_hint')">
      <UButton
        size="sm"
        icon="i-ph-clock-counter-clockwise"
        :color="allPeriods ? 'primary' : 'neutral'"
        :variant="allPeriods ? 'soft' : 'outline'"
        :label="t('api.logs.filters.all_periods')"
        :aria-pressed="allPeriods"
        @click="toggleAllPeriods"
      />
    </UTooltip>

    <template v-if="origin || chips.length">
      <span class="bg-(--ui-border) mx-1 h-4 w-px" aria-hidden="true" />
      <span class="text-muted">
        {{ origin ?? t('api.logs.linked.title') }}
      </span>
      <UBadge
        v-for="chip in chips"
        :key="chip.key"
        :color="chip.invalid ? 'warning' : 'primary'"
        variant="soft"
        class="max-w-[28rem] gap-1.5 font-mono"
      >
        <UIcon
          v-if="chip.invalid"
          name="i-ph-warning"
          class="size-3 shrink-0"
        />
        <span
          class="truncate"
          :title="
            chip.invalid ? t('api.logs.linked.route_unknown_hint') : chip.label
          "
        >
          {{ chip.label }}
        </span>
        <button
          type="button"
          class="hover:text-highlighted"
          :aria-label="t('api.logs.linked.remove', { label: chip.label })"
          @click="apply(chip.remove)"
        >
          <UIcon name="i-ph-x" class="size-3" />
        </button>
      </UBadge>
      <UButton
        v-if="chips.length"
        size="xs"
        color="neutral"
        variant="link"
        :label="t('api.logs.linked.clear')"
        @click="apply({ route: null, path: null, error: null, incident: null })"
      />
    </template>

    <span class="grow" />
    <UTooltip :text="t('api.logs.shortcuts.open')">
      <UButton
        size="sm"
        color="neutral"
        variant="ghost"
        icon="i-ph-keyboard"
        :aria-label="t('api.logs.shortcuts.title')"
        @click="shortcutsOpen = true"
      />
    </UTooltip>

    <UModal v-model:open="shortcutsOpen" :title="t('api.logs.shortcuts.title')">
      <template #body>
        <dl class="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5">
          <template v-for="shortcut in SHORTCUTS" :key="shortcut.label">
            <dt class="flex gap-1">
              <UKbd v-for="key in shortcut.keys" :key="key" :value="key" />
            </dt>
            <dd class="text-toned text-sm">{{ t(shortcut.label) }}</dd>
          </template>
        </dl>
      </template>
    </UModal>
  </div>
</template>
