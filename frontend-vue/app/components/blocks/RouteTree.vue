<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatCount } from '../../utils/format'
import { closestMatch } from '../../utils/search'
import ApiMethodBadge from '../internal/ApiMethodBadge.vue'
import ApiPath from '../internal/ApiPath.vue'

// Every route in scope, grouped by folder, with its traffic and health over
// the last 24 h. The selection is the page's `?route=`, so the rest of the
// page follows it and it survives a reload.
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{ fetchUrl: string; queryKey?: string }>(),
  {
    queryKey: 'route',
  },
)

type RouteState = 'failing' | 'slow' | 'client-errors' | 'healthy' | 'idle'

interface RouteRow {
  ref: string
  method: string
  path: string
  folder: string
  controller: string | null
  handler: string
  requests: number
  state: RouteState
}

interface Folder {
  path: string
  routes: RouteRow[]
  worst: RouteState
}

const METHOD_FILTERS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const STATE_RANK: Record<RouteState, number> = {
  failing: 0,
  slow: 1,
  'client-errors': 2,
  healthy: 3,
  idle: 4,
}
const STATE_DOT: Record<RouteState, string> = {
  failing: 'bg-error shadow-[0_0_8px_var(--ui-error)]',
  slow: 'bg-warning',
  'client-errors': 'bg-warning',
  healthy: 'bg-success',
  idle: 'bg-(--ui-border-accented)',
}

const { t } = useI18n()
const locale = useFormatLocale()
const selection = useRouteSelection(props.queryKey)
const { data, error, pending, refresh } = useApiResource<{
  routes: RouteRow[]
}>(() => props.fetchUrl)

const search = ref('')
const method = ref('all')
const onlyAttention = ref(false)
const collapsed = ref<Set<string>>(new Set())
const searchInput = ref<{ inputRef?: HTMLInputElement } | null>(null)
const list = ref<HTMLElement | null>(null)

const routes = computed(() => data.value?.routes ?? [])
const needsAttention = (route: RouteRow) =>
  STATE_RANK[route.state] < STATE_RANK.healthy
const attentionCount = computed(
  () => routes.value.filter(needsAttention).length,
)

const methodItems = computed(() => [
  { label: t('api.routes.tree.all'), value: 'all' },
  ...METHOD_FILTERS.map((value) => ({
    label: value === 'DELETE' ? 'DEL' : value,
    value,
  })),
])

const visible = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return routes.value.filter(
    (route) =>
      (method.value === 'all' || route.method === method.value) &&
      (!onlyAttention.value || needsAttention(route)) &&
      (!needle ||
        route.path.toLowerCase().includes(needle) ||
        route.handler.toLowerCase().includes(needle) ||
        (route.controller ?? '').toLowerCase().includes(needle)),
  )
})

const folders = computed<Folder[]>(() => {
  const groups = new Map<string, RouteRow[]>()
  for (const route of visible.value) {
    const group = groups.get(route.folder) ?? []
    group.push(route)
    groups.set(route.folder, group)
  }
  return [...groups].map(([path, members]) => ({
    path,
    routes: members,
    worst: members.reduce<RouteState>(
      (worst, route) =>
        STATE_RANK[route.state] < STATE_RANK[worst] ? route.state : worst,
      'idle',
    ),
  }))
})

const flat = computed(() =>
  folders.value.flatMap((folder) =>
    collapsed.value.has(folder.path) ? [] : folder.routes,
  ),
)

const suggestion = computed(() =>
  search.value.trim() && visible.value.length === 0
    ? closestMatch(
        search.value.trim(),
        routes.value.map((route) => route.path),
      )
    : null,
)

function toggleFolder(path: string) {
  const next = new Set(collapsed.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  collapsed.value = next
}

function select(route: RouteRow) {
  void selection.select(route.ref)
}

async function move(step: number) {
  const items = flat.value
  if (items.length === 0) return
  const index = items.findIndex((route) => route.ref === selection.ref.value)
  const next = items[Math.min(items.length - 1, Math.max(0, index + step))]
  if (!next) return
  select(next)
  await nextTick()
  list.value
    ?.querySelector(`[data-route="${CSS.escape(next.ref)}"]`)
    ?.scrollIntoView({ block: 'nearest' })
}

function clearFilters() {
  search.value = ''
  method.value = 'all'
  onlyAttention.value = false
}

function onKey(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  const typing = !!target?.closest(
    'input, textarea, select, [contenteditable="true"]',
  )
  if (event.key === '/' && !typing) {
    event.preventDefault()
    searchInput.value?.inputRef?.focus()
  }
}

function onListKey(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    void move(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    void move(-1)
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// A page opened without a route shows the one that needs a look first.
watch(
  routes,
  (all) => {
    if (selection.ref.value || all.length === 0) return
    const first = [...all].sort(
      (a, b) => STATE_RANK[a.state] - STATE_RANK[b.state],
    )[0]
    if (first) void selection.select(first.ref)
  },
  { immediate: true },
)

const count = (value: number) =>
  new Intl.NumberFormat(locale.value, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
</script>

<template>
  <DmsCard
    :padded="false"
    class="flex min-h-[24rem] flex-col overflow-hidden lg:max-h-[calc(100vh-7rem)]"
  >
    <div class="border-default flex flex-col gap-2.5 border-b p-3">
      <UInput
        ref="searchInput"
        v-model="search"
        icon="i-ph-magnifying-glass"
        size="sm"
        :placeholder="t('api.routes.tree.search')"
        :aria-label="t('api.routes.tree.search')"
      >
        <template #trailing>
          <UKbd value="/" />
        </template>
      </UInput>
      <DmsSegmented
        v-model="method"
        :items="methodItems"
        size="sm"
        variant="mono"
        block
        :aria-label="t('api.routes.tree.method')"
      />
      <label
        class="text-muted flex cursor-pointer items-center gap-2 text-[13px]"
      >
        <USwitch v-model="onlyAttention" size="sm" />
        <span class="grow">{{ t('api.routes.tree.only_attention') }}</span>
        <DmsStatusPill
          v-if="attentionCount"
          tone="warning"
          :label="String(attentionCount)"
          dot="none"
          size="sm"
        />
      </label>
    </div>

    <div
      ref="list"
      class="min-h-0 flex-1 overflow-y-auto py-1.5 focus:outline-none"
      tabindex="0"
      role="listbox"
      :aria-label="t('api.routes.tree.label')"
      :aria-activedescendant="
        selection.ref.value ? `route-${selection.ref.value}` : undefined
      "
      @keydown="onListKey"
    >
      <div v-if="pending" class="flex flex-col gap-2 px-3 py-2">
        <USkeleton v-for="index in 8" :key="index" class="h-6 w-full" />
      </div>
      <DmsEmptyState
        v-else-if="error && !data"
        size="sm"
        variant="error"
        :title="t('api.routes.tree.error')"
        :actions="[{ label: t('api.common.retry'), onClick: () => refresh() }]"
      />
      <DmsEmptyState
        v-else-if="routes.length === 0"
        size="sm"
        :title="t('api.routes.tree.empty_title')"
        :description="t('api.routes.tree.empty_description')"
      />
      <DmsEmptyState
        v-else-if="visible.length === 0"
        size="sm"
        variant="no-result"
        :title="
          search.trim()
            ? t('api.routes.tree.no_match', { search: search.trim() })
            : t('api.routes.tree.no_match_filters')
        "
        :actions="[
          {
            label: t('api.routes.tree.clear'),
            color: 'neutral',
            variant: 'outline',
            onClick: clearFilters,
          },
        ]"
      >
        <p v-if="suggestion" class="text-muted text-sm">
          {{ t('api.routes.tree.did_you_mean') }}
          <button
            type="button"
            class="text-primary font-mono hover:underline"
            @click="search = suggestion"
          >
            {{ suggestion }}
          </button>
        </p>
      </DmsEmptyState>

      <template v-else>
        <div v-for="folder in folders" :key="folder.path" class="mb-1">
          <button
            type="button"
            class="text-muted hover:text-default flex w-full items-center gap-1.5 px-3 py-1.5 font-mono text-[12px]"
            :aria-expanded="!collapsed.has(folder.path)"
            @click="toggleFolder(folder.path)"
          >
            <UIcon
              :name="
                collapsed.has(folder.path)
                  ? 'i-ph-caret-right'
                  : 'i-ph-caret-down'
              "
              class="size-3"
            />
            <span class="truncate">{{ folder.path }}</span>
            <span class="grow" />
            <span
              v-if="STATE_RANK[folder.worst] < STATE_RANK.healthy"
              class="size-1.5 rounded-full"
              :class="STATE_DOT[folder.worst]"
            />
            <span class="text-dimmed">{{ folder.routes.length }}</span>
          </button>
          <template v-if="!collapsed.has(folder.path)">
            <button
              v-for="route in folder.routes"
              :id="`route-${route.ref}`"
              :key="route.ref"
              type="button"
              role="option"
              :aria-selected="route.ref === selection.ref.value"
              :data-route="route.ref"
              class="group mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[12.5px] transition-colors"
              :class="
                route.ref === selection.ref.value
                  ? 'border-primary/60 bg-primary/10 text-highlighted'
                  : 'hover:bg-elevated text-default border-transparent'
              "
              @click="select(route)"
            >
              <ApiMethodBadge :method="route.method" size="sm" />
              <ApiPath :path="route.path" :prefix="folder.path" class="grow" />
              <span class="text-dimmed font-mono text-[11px] tabular-nums">
                {{ count(route.requests) }}
              </span>
              <span
                class="size-1.5 shrink-0 rounded-full"
                :class="STATE_DOT[route.state]"
                :title="t(`api.routes.state.${route.state.replace('-', '_')}`)"
              />
            </button>
          </template>
        </div>
      </template>
    </div>

    <div
      class="border-default text-dimmed flex items-center gap-2 border-t px-3 py-2 font-mono text-[11px]"
    >
      <span>
        {{
          t('api.routes.tree.footer', {
            shown: formatCount(visible.length, locale),
            total: formatCount(routes.length, locale),
            folders: folders.length,
          })
        }}
      </span>
      <span class="grow" />
      <UKbd value="↑" size="sm" />
      <UKbd value="↓" size="sm" />
    </div>
  </DmsCard>
</template>
