<script setup lang="ts">
import { computed } from 'vue'
import type {
  ApiTreeNode,
  TreeNodeStats,
} from '../../composables/useApiIntrospection'
import ApiMethodBadge from './ApiMethodBadge.vue'
// Recurses into branch folders via its Nuxt auto-import name
// (<DmsApiRouteTreeNode>) — no explicit self-import needed.

// One folder node of the routes tree. The backend builds the tree one folder
// per path segment, so most routes bottom out in a *terminal* folder whose only
// children are method leaves (e.g. `home/pagelayout` → GET). To match the DMS
// maquette — which lists routes as flat "method + name + health icons" leaves —
// we flatten those terminal sub-folders into route rows and only keep folders
// that still branch (have sub-folders) as expandable nodes.
const props = defineProps<{
  node: ApiTreeNode
  depth: number
  expanded: Set<string>
  forceExpand: boolean
  activeRouteId?: string
}>()

const emit = defineEmits<{
  toggle: [path: string]
  selectRoute: [routeId: string]
}>()

const path = computed(() => props.node.value ?? '')
const isOpen = computed(
  () => props.forceExpand || props.expanded.has(path.value),
)

interface RouteRow {
  routeId: string
  method: string
  name: string
  stats?: TreeNodeStats
}

function isFolder(n: ApiTreeNode): boolean {
  return n.expandable === true
}
function isTerminal(folder: ApiTreeNode): boolean {
  return (folder.children ?? []).every((c) => !isFolder(c))
}
function leafRows(folder: ApiTreeNode, name: string): RouteRow[] {
  return (folder.children ?? [])
    .filter((c) => !isFolder(c))
    .map((leaf) => ({
      routeId: leaf.value as string,
      method: leaf.label,
      name,
      stats: leaf.customData as TreeNodeStats | undefined,
    }))
}

// Route rows shown directly under this folder: this folder's own method leaves
// (named after this folder) + every terminal sub-folder's leaves (named after
// that sub-folder).
const routeRows = computed<RouteRow[]>(() => {
  const own = leafRows(props.node, props.node.label)
  const fromTerminal = (props.node.children ?? [])
    .filter((c) => isFolder(c) && isTerminal(c))
    .flatMap((f) => leafRows(f, f.label))
  return [...own, ...fromTerminal]
})

// Sub-folders that still branch — rendered as nested expandable folders.
const branchFolders = computed(() =>
  (props.node.children ?? []).filter((c) => isFolder(c) && !isTerminal(c)),
)

// Health indicators: an orange timer when the route is slow, a warning
// triangle when it errors. Healthy / no-traffic routes show nothing.
interface HealthIcon {
  name: string
  class: string
  title: string
}

// Error rate (0-1) above which the node shows a warning icon.
const ELEVATED_ERROR_RATE = 0.05

function healthIcons(stats?: TreeNodeStats): HealthIcon[] {
  if (!stats || stats.requestsCount === 0) return []
  const icons: HealthIcon[] = []
  if (stats.errorRate > ELEVATED_ERROR_RATE) {
    icons.push({
      name: 'i-ph-warning',
      class: 'text-error',
      title: `${(stats.errorRate * 100).toFixed(0)}% err`,
    })
  }
  if (stats.slow) {
    icons.push({
      name: 'i-ph-timer',
      class: 'text-warning',
      title: 'slow',
    })
  }
  return icons
}
</script>

<template>
  <div>
    <!-- folder row -->
    <button
      type="button"
      class="group flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm text-toned transition-colors hover:bg-elevated/60"
      :style="{ paddingLeft: `${depth * 14 + 8}px` }"
      @click="emit('toggle', path)"
    >
      <UIcon
        name="i-ph-caret-right"
        class="size-3.5 shrink-0 text-dimmed transition-transform duration-150"
        :class="{ 'rotate-90': isOpen }"
      />
      <UIcon name="i-ph-folder" class="size-4 shrink-0 text-dimmed" />
      <span class="truncate font-medium">{{ node.label }}</span>
    </button>

    <div v-show="isOpen">
      <!-- route rows (this folder's routes + flattened terminal sub-folders) -->
      <button
        v-for="row in routeRows"
        :key="row.routeId"
        type="button"
        class="flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left transition-colors"
        :class="
          activeRouteId === row.routeId
            ? 'bg-primary/10 text-primary'
            : 'text-toned hover:bg-elevated/60'
        "
        :style="{ paddingLeft: `${(depth + 1) * 14 + 10}px` }"
        @click="emit('selectRoute', row.routeId)"
      >
        <ApiMethodBadge :method="row.method" size="sm" />
        <span class="truncate font-mono text-xs">{{ row.name }}</span>
        <span class="ml-auto flex shrink-0 items-center gap-1">
          <UIcon
            v-for="icon in healthIcons(row.stats)"
            :key="icon.name"
            :name="icon.name"
            class="size-3.5"
            :class="icon.class"
            :title="icon.title"
          />
        </span>
      </button>

      <!-- nested branch folders (recursion via Nuxt auto-import) -->
      <DmsApiRouteTreeNode
        v-for="folder in branchFolders"
        :key="folder.value ?? folder.label"
        :node="folder"
        :depth="depth + 1"
        :expanded="expanded"
        :force-expand="forceExpand"
        :active-route-id="activeRouteId"
        @toggle="emit('toggle', $event)"
        @select-route="emit('selectRoute', $event)"
      />
    </div>
  </div>
</template>
