<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ApiTreeNode } from '../composables/useApiIntrospection'
import { ANY_FILTER, httpMethodFilterItems } from '../utils/httpMethod'
import RouteTreeNode from './internal/RouteTreeNode.vue'

// v2 routes tree panel (DMS apiv2-routes): header + filter (search + method
// select, mirroring the Logs page toolbar) + recursive folder/route tree with
// per-route health icons. The backend tree is built one folder per path
// segment; leaves are method nodes whose `value` is the runtime route id used
// by the per-route endpoints.
const props = defineProps<{
  /**
   * Window ('Nd') the tree health icons are computed over, or null while the
   * page's period selector has yet to resolve one. The tree waits on it rather
   * than fetching a guessed window and reloading a moment later.
   */
  period: string | null
}>()

const emit = defineEmits<{
  'select-route': [routeId: string]
}>()

const { getTree } = useApiIntrospection()

const items = ref<ApiTreeNode[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const search = ref('')
const expanded = ref<Set<string>>(new Set())
const activeRouteId = ref<string | undefined>()

// Same method filter as the Logs page toolbar.
const methodFilter = ref(ANY_FILTER)

const { t } = useI18n()

const methodOptions = computed(() =>
  httpMethodFilterItems(t('page.api.filters.all_methods')),
)

function methodAllowed(method: string): boolean {
  if (methodFilter.value === ANY_FILTER) return true
  return method.toUpperCase() === methodFilter.value
}

// The health stats baked into the tree follow the page-level period selector.
// Immediate, so the first window to arrive is also the first one fetched; the
// panel shows its loading skeleton until then.
watch(() => props.period, () => void load(), { immediate: true })

// Filter a folder against the search query + active method chips. A leaf is
// kept when its method is allowed and the route path (the folder value) or
// the folder name matches the query. A folder is kept when it still has any
// leaf or sub-folder after filtering.
function filterFolder(folder: ApiTreeNode, q: string): ApiTreeNode | null {
  const path = (folder.value ?? '').toLowerCase()
  const label = folder.label.toLowerCase()
  const pathMatch = !q || path.includes(q) || label.includes(q)

  const leaves = (folder.children ?? [])
    .filter((c) => !c.expandable)
    .filter((leaf) => methodAllowed(leaf.label) && pathMatch)

  const folders = (folder.children ?? [])
    .filter((c) => c.expandable)
    .map((f) => filterFolder(f, q))
    .filter((f): f is ApiTreeNode => f !== null)

  if (leaves.length === 0 && folders.length === 0) return null
  return { ...folder, children: [...leaves, ...folders] }
}

const query = computed(() => search.value.trim().toLowerCase())
const forceExpand = computed(() => query.value.length > 0)

const displayTree = computed(() =>
  items.value
    .map((f) => filterFolder(f, query.value))
    .filter((f): f is ApiTreeNode => f !== null),
)

function firstLeafId(nodes: ApiTreeNode[]): string | undefined {
  for (const node of nodes) {
    if (!node.expandable && node.value) return node.value
    if (node.children) {
      const found = firstLeafId(node.children)
      if (found) return found
    }
  }
  return undefined
}

async function load() {
  const period = props.period
  if (!period) return
  loading.value = true
  error.value = null
  try {
    items.value = await getTree(period)
    // Open the first top folder and auto-select its first route, like the
    // maquette which lands on the first leaf — but only on the first load.
    // Reloads come from the page-header period control, and re-seeding here
    // would collapse whatever the user had opened every time they change it.
    if (!activeRouteId.value) {
      const first = items.value[0]
      if (first?.value) expanded.value = new Set([first.value])
      const id = firstLeafId(items.value)
      if (id) selectRoute(id)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function toggle(path: string) {
  const next = new Set(expanded.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  expanded.value = next
}

function selectRoute(routeId: string) {
  activeRouteId.value = routeId
  emit('select-route', routeId)
}

</script>

<template>
  <div class="flex h-full w-full flex-col">
    <!-- panel head -->
    <div
      class="flex items-center justify-between gap-2 border-b border-default px-4 py-3"
    >
      <h2 class="text-sm font-semibold text-highlighted">
        {{ $t('page.api.routes.tree_title') }}
      </h2>
      <UButton
        icon="i-ph-arrow-clockwise"
        size="xs"
        color="neutral"
        variant="ghost"
        :loading="loading"
        :aria-label="$t('page.api.routes.tree_refresh')"
        @click="load"
      />
    </div>

    <!-- filter: search, then the method select below (same controls as the
         Logs toolbar, minus status; the period lives in the page header) -->
    <div class="flex flex-col gap-2 border-b border-default px-4 py-3">
      <UInput
        v-model="search"
        icon="i-ph-magnifying-glass"
        size="sm"
        :placeholder="$t('page.api.routes.filter_placeholder')"
      />
      <USelect v-model="methodFilter" :items="methodOptions" size="sm" class="w-full" />
    </div>

    <!-- tree -->
    <div class="min-h-0 flex-1 overflow-auto p-2">
      <div v-if="error" class="px-2 py-3 text-sm text-error">{{ error }}</div>

      <div v-else-if="loading" class="flex flex-col gap-1.5 p-1">
        <USkeleton v-for="i in 8" :key="i" class="h-7 w-full" />
      </div>

      <div
        v-else-if="displayTree.length === 0"
        class="flex flex-col items-center gap-2 px-3 py-8 text-center text-dimmed"
      >
        <UIcon name="i-ph-funnel-x" class="size-6" />
        <small>{{ $t('page.api.routes.no_match') }}</small>
      </div>

      <RouteTreeNode
        v-for="folder in displayTree"
        v-else
        :key="folder.value ?? folder.label"
        :node="folder"
        :depth="0"
        :expanded="expanded"
        :force-expand="forceExpand"
        :active-route-id="activeRouteId"
        @toggle="toggle"
        @select-route="selectRoute"
      />
    </div>
  </div>
</template>
