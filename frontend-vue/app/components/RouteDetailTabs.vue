<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  RouteDocPayload,
  RouteInspection,
  RouteStatsPayload,
} from '../composables/useApiIntrospection'
import ConfigurationView from './ConfigurationView.vue'
import DocumentationView from './DocumentationView.vue'
import ApiMethodBadge from './internal/ApiMethodBadge.vue'
import StatsView from './StatsView.vue'
import TesterPanel from './TesterPanel.vue'

const props = defineProps<{
  routeId: string
  /** Stats window ('Nd'), picked in the tree panel. */
  period?: string
}>()

const { getRouteDoc, getRouteConfig, getRouteStats } = useApiIntrospection()

const doc = ref<RouteDocPayload | null>(null)
const config = ref<RouteInspection | null>(null)
const stats = ref<RouteStatsPayload | null>(null)
const docLoading = ref(false)
const configLoading = ref(false)
const statsLoading = ref(false)
const docError = ref<string | null>(null)
const configError = ref<string | null>(null)
const statsError = ref<string | null>(null)

// Statistics first + active by default, mirroring the DMS mockup where the
// stats tab is what you land on after picking a route.
const active = ref<'statistics' | 'documentation' | 'tester' | 'configuration'>(
  'statistics',
)

const TABS = [
  { value: 'statistics', label: 'page.api.routes.tabs.statistics', icon: 'i-ph-chart-bar' },
  { value: 'documentation', label: 'page.api.routes.tabs.documentation', icon: 'i-ph-book-open' },
  { value: 'tester', label: 'page.api.routes.tabs.tester', icon: 'i-ph-play' },
  { value: 'configuration', label: 'page.api.routes.tabs.configuration', icon: 'i-ph-sliders' },
] as const

// Pathbar method + location: whichever of doc/config has resolved.
const pathMethod = computed(
  () => doc.value?.method ?? config.value?.method ?? '',
)
const pathLocation = computed(
  () => doc.value?.location ?? config.value?.location ?? '',
)

async function load<T>(
  loader: () => Promise<T>,
  store: { value: T | null },
  loading: { value: boolean },
  error: { value: string | null },
) {
  loading.value = true
  error.value = null
  try {
    store.value = await loader()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

watch(
  () => props.routeId,
  (id) => {
    doc.value = null
    config.value = null
    stats.value = null
    active.value = 'statistics'
    void load(() => getRouteDoc(id), doc, docLoading, docError)
    void load(() => getRouteConfig(id), config, configLoading, configError)
    void load(() => getRouteStats(id, props.period), stats, statsLoading, statsError)
  },
  { immediate: true },
)

// Period only affects the Statistics tab — doc/config are window-agnostic.
watch(
  () => props.period,
  () => {
    stats.value = null
    void load(
      () => getRouteStats(props.routeId, props.period),
      stats,
      statsLoading,
      statsError,
    )
  },
)
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- route pathbar -->
    <div
      class="flex items-center gap-3 border-b border-default px-5 py-4 sm:px-6"
    >
      <ApiMethodBadge v-if="pathMethod" :method="pathMethod" size="md" />
      <USkeleton v-else class="h-6 w-14" />
      <code class="min-w-0 flex-1 truncate font-mono text-sm text-highlighted">
        {{ pathLocation || '—' }}
      </code>
      <DmsCopyButton v-if="pathLocation" :value="pathLocation" />
    </div>

    <!-- tab bar -->
    <div class="flex items-center gap-1 border-b border-default px-3 sm:px-4">
      <button
        v-for="t in TABS"
        :key="t.value"
        type="button"
        class="-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors"
        :class="
          active === t.value
            ? 'border-primary text-primary'
            : 'border-transparent text-muted hover:text-highlighted'
        "
        @click="active = t.value"
      >
        <UIcon :name="t.icon" class="size-4" />
        <span>{{ $t(t.label) }}</span>
      </button>
    </div>

    <!-- panels -->
    <div class="flex-1 p-5 sm:p-6">
      <!-- Statistics -->
      <template v-if="active === 'statistics'">
        <div v-if="statsError" class="text-sm text-error">{{ statsError }}</div>
        <div v-else-if="statsLoading || !stats" class="flex flex-col gap-4">
          <USkeleton class="h-20 w-full" />
          <USkeleton class="h-56 w-full" />
        </div>
        <StatsView v-else :stats="stats" />
      </template>

      <!-- Documentation -->
      <template v-else-if="active === 'documentation'">
        <div v-if="docError" class="text-sm text-error">{{ docError }}</div>
        <div v-else-if="docLoading || !doc" class="flex flex-col gap-3">
          <USkeleton class="h-8 w-1/2" />
          <USkeleton class="h-32 w-full" />
        </div>
        <DocumentationView v-else :doc="doc" />
      </template>

      <!-- Tester -->
      <template v-else-if="active === 'tester'">
        <div v-if="configError" class="text-sm text-error">{{ configError }}</div>
        <div v-else-if="configLoading || !config">
          <USkeleton class="h-8 w-1/3" />
        </div>
        <TesterPanel v-else :route="config" />
      </template>

      <!-- Configuration -->
      <template v-else>
        <div v-if="configError" class="text-sm text-error">{{ configError }}</div>
        <div v-else-if="configLoading || !config" class="flex flex-col gap-3">
          <USkeleton class="h-8 w-1/3" />
          <USkeleton class="h-24 w-full" />
        </div>
        <ConfigurationView
          v-else
          :parameters="config.parameters"
          :properties="config.properties"
          :middleware="config.applicableMiddleware"
        />
      </template>
    </div>
  </div>
</template>
