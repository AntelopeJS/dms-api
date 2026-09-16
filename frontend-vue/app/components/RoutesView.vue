<script setup lang="ts">
import { ref } from 'vue'
import PeriodSelect from './internal/PeriodSelect.vue'
import RouteDetailTabs from './RouteDetailTabs.vue'
import RouteTree from './RouteTree.vue'

// v2 Routes page (DMS apiv2-routes): master-detail. Left a tree panel
// (folders + routes, filter, health dots); right the per-route detail with
// Statistics / Documentation / Tester / Configuration tabs. Composed from dms
// surfaces (DmsCard) so the theme is inherited.
const selectedRouteId = ref<string | null>(null)

// Stats window, from the period filter shared with the Overview and Logs
// pages. It drives both the tree health icons and the selected route's
// Statistics tab, and stays null until <PeriodSelect> resolves one so nothing
// fetches a window nobody picked.
const period = ref<string | null>(null)

function onRoute(id: string) {
  selectedRouteId.value = id
}
</script>

<template>
  <div class="flex h-full w-full flex-col gap-5 p-6">
    <!-- page head -->
    <header class="flex flex-wrap items-center gap-4">
      <div
        class="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"
      >
        <UIcon name="i-ph-tree-structure" class="size-[22px]" />
      </div>
      <div class="min-w-0 flex-1">
        <h1 class="text-2xl font-semibold tracking-tight text-highlighted">
          {{ $t('page.api.routes.title') }}
        </h1>
        <p class="text-sm text-muted">
          {{ $t('page.api.routes.description') }}
        </p>
      </div>
      <PeriodSelect v-model="period" class="w-32" />
    </header>

    <!-- master-detail split -->
    <div
      class="grid min-h-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(280px,340px)_1fr]"
    >
      <!-- left: tree -->
      <DmsCard
        :padded="false"
        class="flex max-h-[calc(100vh-13rem)] flex-col overflow-hidden"
      >
        <RouteTree :period="period" @select-route="onRoute" />
      </DmsCard>

      <!-- right: detail -->
      <DmsCard
        :padded="false"
        class="max-h-[calc(100vh-13rem)] overflow-auto"
      >
        <RouteDetailTabs
          v-if="selectedRouteId && period"
          :key="selectedRouteId"
          :route-id="selectedRouteId"
          :period="period"
        />
        <div
          v-else
          class="flex h-full min-h-[340px] flex-col items-center justify-center gap-2 px-6 text-center"
        >
          <UIcon name="i-ph-tree-structure" class="size-8 text-dimmed" />
          <p class="text-base font-medium text-highlighted">
            {{ $t('page.api.routes.placeholder.title') }}
          </p>
          <p class="max-w-md text-sm text-muted">
            {{ $t('page.api.routes.placeholder.description') }}
          </p>
        </div>
      </DmsCard>
    </div>
  </div>
</template>
