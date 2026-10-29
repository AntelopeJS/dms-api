<script setup lang="ts">
import { formatCount } from '../../utils/format'
import type { ExplorerRoute, RouteFolder } from '../../utils/routeExplorer'

// The route list's last line: what it shows of how many, and the folders'
// expand / collapse toggle.
defineProps<{
  visible: ExplorerRoute[]
  routes: ExplorerRoute[]
  folders: RouteFolder[]
  flatMode: boolean
  allCollapsed: boolean
  locale: string
  toggleAll: () => void
}>()

const { t } = useI18n()
</script>

<template>
  <div
    class="border-default text-dimmed flex items-center gap-2 border-t px-3 py-2 font-mono text-[11px]"
  >
    <!-- The count wraps rather than being cut: the toggle beside it is an
             icon, its name in a tooltip, so the line usually holds it all. -->
    <span class="min-w-0">
      {{
        t(flatMode ? 'api.routes.tree.footer_flat' : 'api.routes.tree.footer', {
          shown: formatCount(visible.length, locale),
          total: formatCount(routes.length, locale),
          folders: folders.length,
        })
      }}
    </span>
    <span class="grow" />
    <UTooltip
      v-if="!flatMode && folders.length > 1"
      :text="
        allCollapsed
          ? t('api.routes.tree.expand_all')
          : t('api.routes.tree.collapse_all')
      "
    >
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        square
        class="shrink-0"
        :icon="allCollapsed ? 'i-ph-caret-up-down' : 'i-ph-caret-line-up'"
        :aria-label="
          allCollapsed
            ? t('api.routes.tree.expand_all')
            : t('api.routes.tree.collapse_all')
        "
        @click="toggleAll"
      />
    </UTooltip>
    <UKbd value="↑" size="sm" class="@max-5xl:hidden shrink-0" />
    <UKbd value="↓" size="sm" class="@max-5xl:hidden shrink-0" />
  </div>
</template>
