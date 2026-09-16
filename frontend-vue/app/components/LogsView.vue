<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import type {
  LogFilters,
  RequestLogSummary,
} from '../composables/useApiIntrospection'
import {
  ANY_FILTER,
  httpMethodColor,
  httpMethodFilterItems,
} from '../utils/httpMethod'
import PeriodSelect from './internal/PeriodSelect.vue'

const { getLogs } = useApiIntrospection()
const { loadingDetailId, openLogDetail } = useLogDetailDrawer()

const PAGE_SIZE = 50
const POLL_INTERVAL_MS = 5_000
// Live mode keeps only the newest N rows in memory so long sessions don't grow
// unbounded.
const LIVE_LOG_CAP = 500

const route = useDmsRoute()

// Deep link from the overview cards: /logs?search=<uri>&period=<value> lands
// pre-filtered on the route URI and the window the user was looking at.
function queryString(key: string): string | undefined {
  const value = route.query[key]
  return typeof value === 'string' && value ? value : undefined
}

const deepLinkPeriod = queryString('period')

// The window is owned by <PeriodSelect> (shared with the Overview and Routes
// pages) and stays null until it resolves one, so nothing fetches before the
// log retention is known. The other three filters start unfiltered.
const period = ref<string | null>(null)

const filters = reactive<{
  method: string
  status: string
  search: string
}>({
  method: ANY_FILTER,
  status: ANY_FILTER,
  search: queryString('search') ?? '',
})

// buildFilters() below strips the ANY_FILTER sentinel so the backend sees no
// filter for that field.
const ANY = ANY_FILTER

const { t } = useI18n()

const methodOptions = computed(() =>
  httpMethodFilterItems(t('page.api.filters.all_methods')),
)

// "slow" piggybacks on the status select: it maps onto the backend's
// tab=slow filter (requests above the slowness threshold), which lost its
// UI entry point when the tab bar was removed.
const SLOW = 'slow'

const statusOptions = computed(() => [
  { value: ANY, label: t('page.api.filters.all_statuses') },
  { value: 'success', label: t('page.api.filters.status_success') },
  { value: 'client-error', label: t('page.api.filters.status_client') },
  { value: 'server-error', label: t('page.api.filters.status_server') },
  { value: SLOW, label: t('page.api.filters.slow_only') },
])

const rows = ref<RequestLogSummary[]>([])
const nextCursor = ref<string | null>(null)
// Starts true: the list is waiting on <PeriodSelect> to name a window, and
// rendering "no logs match the current filters" during that reads as a broken
// page rather than a loading one.
const loading = ref(true)
const loadingMore = ref(false)
const error = ref<string | null>(null)
const live = ref(false)
let pollHandle: ReturnType<typeof setInterval> | undefined

function buildFilters(extra: Partial<LogFilters> = {}): LogFilters {
  const f: LogFilters = { limit: PAGE_SIZE, ...extra }
  if (period.value) f.period = period.value
  if (filters.method && filters.method !== ANY) f.method = filters.method
  if (filters.status === SLOW) f.tab = 'slow'
  else if (filters.status && filters.status !== ANY) f.status = filters.status
  if (filters.search) f.search = filters.search
  return f
}

// Every first-page fetch takes a ticket. A slower response from an earlier
// filter would otherwise land last and pair its rows with the newer request's
// cursor, so Load more would append entries from a different query.
let requestGeneration = 0

async function loadFirst() {
  if (!period.value) return
  const generation = ++requestGeneration
  loading.value = true
  error.value = null
  try {
    const page = await getLogs(buildFilters())
    if (generation !== requestGeneration) return
    rows.value = page.results
    nextCursor.value = page.nextCursor
  } catch (e) {
    if (generation !== requestGeneration) return
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (generation === requestGeneration) loading.value = false
  }
}

async function loadMore() {
  if (!nextCursor.value || loadingMore.value) return
  loadingMore.value = true
  try {
    const page = await getLogs(buildFilters({ cursor: nextCursor.value }))
    rows.value = rows.value.concat(page.results)
    nextCursor.value = page.nextCursor
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loadingMore.value = false
  }
}

async function pollLatest() {
  try {
    const page = await getLogs(buildFilters())
    if (page.results.length === 0) return
    const existing = new Set(rows.value.map((r) => r._id))
    const fresh = page.results.filter((r) => !existing.has(r._id))
    if (fresh.length > 0) {
      rows.value = fresh.concat(rows.value).slice(0, LIVE_LOG_CAP)
    }
  } catch {
    /* polling errors are silent */
  }
}

function stopPolling() {
  if (pollHandle) {
    clearInterval(pollHandle)
    pollHandle = undefined
  }
}

function toggleLive() {
  live.value = !live.value
  if (live.value) {
    pollHandle = setInterval(pollLatest, POLL_INTERVAL_MS)
  } else {
    stopPolling()
  }
}

let searchDebounce: ReturnType<typeof setTimeout> | undefined
function onSearchInput() {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => void loadFirst(), 250)
}

// The window and the two selects all re-run the query. Immediate, so the first
// fetch is the one that follows <PeriodSelect> resolving its window — nothing
// fires while it is still null.
watch(
  () => [period.value, filters.method, filters.status],
  () => void loadFirst(),
  { immediate: true },
)

onUnmounted(stopPolling)

// Level labels mirror the module's status terminology ("4xx client" /
// "5xx server" filters, Client/Server breakdown) — a 4xx is a client error,
// not a warning.
function statusLevel(s: number): { label: string; color: string } {
  if (s >= 500) return { label: 'SERVER', color: 'text-error' }
  if (s >= 400) return { label: 'CLIENT', color: 'text-warning' }
  if (s >= 300) return { label: 'INFO', color: 'text-info' }
  return { label: 'INFO', color: 'text-success' }
}

function fmtTimestamp(ts: string): string {
  const d = new Date(ts)
  return `${d.toLocaleTimeString()}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

function fmtRequestId(id: string): string {
  return `req_${id.slice(0, 8)}`
}

const counts = computed(() => {
  let info = 0
  let client = 0
  let server = 0
  for (const r of rows.value) {
    if (r.statusCode >= 500) server++
    else if (r.statusCode >= 400) client++
    else info++
  }
  return { info, client, server }
})
</script>

<template>
  <div class="flex w-full flex-col gap-5 p-6">
    <header class="flex flex-wrap items-center gap-4">
      <div
        class="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"
      >
        <UIcon name="i-ph-list-magnifying-glass" class="size-[22px]" />
      </div>
      <div class="min-w-0 flex-1">
        <h1 class="text-2xl font-semibold tracking-tight text-highlighted">
          {{ $t('page.api.logs.title') }}
        </h1>
        <p class="text-sm text-muted">
          {{ $t('page.api.logs.description') }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <UButton
          :icon="live ? 'i-ph-pause' : 'i-ph-play'"
          :color="live ? 'warning' : 'neutral'"
          variant="ghost"
          size="sm"
          @click="toggleLive"
        >
          {{ live ? $t('page.api.logs.pause') : $t('page.api.logs.live') }}
        </UButton>
        <UButton
          icon="i-ph-arrow-clockwise"
          variant="ghost"
          size="sm"
          :loading="loading"
          @click="loadFirst"
        >
          {{ $t('page.api.logs.refresh') }}
        </UButton>
      </div>
    </header>

    <DmsCard :padded="false" class="flex flex-col overflow-hidden">
      <!-- Filter toolbar -->
      <div
        class="flex flex-wrap items-center gap-2 border-b border-default px-4 py-3"
      >
        <UInput
          v-model="filters.search"
          size="sm"
          icon="i-ph-magnifying-glass"
          :placeholder="$t('page.api.logs.search_placeholder')"
          class="grow"
          @update:model-value="onSearchInput"
        />
        <PeriodSelect v-model="period" kind="logs" :deep-link="deepLinkPeriod" />
        <USelect v-model="filters.method" :items="methodOptions" size="sm" />
        <USelect v-model="filters.status" :items="statusOptions" size="sm" />
      </div>

      <div
        v-if="error"
        class="m-4 rounded-lg border border-error bg-error/10 p-3 text-sm text-error"
      >
        {{ error }}
      </div>

      <!-- Console-style log list. The row list scrolls internally so the
           toolbar and footer stay pinned. -->
      <div
        class="flex max-h-[calc(100vh-24rem)] min-h-[360px] flex-col overflow-hidden font-mono text-xs"
      >
        <div v-if="rows.length === 0 && !loading" class="p-8 text-center text-muted">
          {{ $t('page.api.logs.empty') }}
        </div>

        <div v-else class="flex-1 overflow-y-auto">
          <div
            v-for="row in rows"
            :key="row._id"
            class="grid cursor-pointer grid-cols-[148px_56px_64px_1fr_56px_64px_104px] items-center gap-2 border-b border-default/40 px-4 py-1.5 hover:bg-elevated/50"
            :class="{
              'bg-error/5': row.statusCode >= 500,
              'bg-warning/5': row.statusCode >= 400 && row.statusCode < 500,
            }"
            @click="openLogDetail(row)"
          >
            <span class="text-dimmed">[{{ fmtTimestamp(row.timestamp) }}]</span>
            <span class="font-semibold" :class="statusLevel(row.statusCode).color">
              {{ statusLevel(row.statusCode).label }}
            </span>
            <span class="font-semibold" :class="`text-${httpMethodColor(row.method)}`">
              {{ row.method.toUpperCase() }}
            </span>
            <span class="truncate text-toned">{{ row.uri }}</span>
            <span class="text-right" :class="statusLevel(row.statusCode).color">
              {{ row.statusCode }}
            </span>
            <span class="text-right text-dimmed">
              {{ Math.round(row.responseTimeMs) }}ms
            </span>
            <span class="truncate text-right text-dimmed">
              {{ fmtRequestId(row._id) }}
              <UIcon
                v-if="loadingDetailId === row._id"
                name="i-ph-spinner"
                class="ml-1 animate-spin"
              />
            </span>
          </div>

          <div v-if="nextCursor" class="p-2 text-center">
            <UButton size="xs" variant="ghost" :loading="loadingMore" @click="loadMore">
              {{ $t('page.api.logs.load_more') }}
            </UButton>
          </div>
        </div>

        <div v-if="loading && rows.length === 0" class="space-y-1 p-4">
          <USkeleton v-for="i in 8" :key="i" class="h-5 w-full" />
        </div>
      </div>

      <!-- Status bar (foot) -->
      <div
        class="flex items-center justify-between border-t border-default px-4 py-2.5 text-xs text-dimmed"
      >
        <div class="flex items-center gap-3">
          <span v-if="live" class="flex items-center gap-1.5 text-success">
            <span class="inline-block size-2 animate-pulse rounded-full bg-success" />
            {{ $t('page.api.logs.live_status') }}
          </span>
          <span>{{ rows.length }} {{ $t('page.api.logs.entries') }}</span>
        </div>
        <div class="flex items-center gap-3 font-mono">
          <span>INFO: <b class="text-toned">{{ counts.info }}</b></span>
          <span class="text-warning">CLIENT: <b>{{ counts.client }}</b></span>
          <span class="text-error">SERVER: <b>{{ counts.server }}</b></span>
        </div>
      </div>
    </DmsCard>
  </div>
</template>
