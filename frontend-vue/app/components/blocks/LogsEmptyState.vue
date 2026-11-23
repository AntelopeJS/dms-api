<script setup lang="ts">
import { computed } from 'vue'
import {
  clearedLogsFilters,
  hasLogsFilters,
  isAllTime,
  logsEmptyCause,
  readLogsFilters,
  windowPreset,
  withLogsFilters,
  type LogsFilters,
} from '../../utils/logsQuery'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  state?: 'firstRun' | 'filtered' | 'error'
  search?: string
  refresh?: () => void
  /** Unset while nothing is searched. */
  clearSearch?: () => void
}>()

const { t } = useI18n()
const route = useDmsRoute()
const router = useDmsRouter()

const filters = computed(() => readLogsFilters(route.query))
const period = useApiPeriod()
const cause = computed(() =>
  logsEmptyCause(props.state, props.search, filters.value, period.value),
)

/** "Last hour · POST · Slow only": the URL's filters, besides the links. */
function describeFilters(current: LogsFilters): string[] {
  const preset = windowPreset(period.value)
  return [
    preset ? t(`api.logs.windows.${preset}`) : undefined,
    current.method,
    current.slow ? t('api.logs.filters.slow') : undefined,
  ].filter((part): part is string => !!part)
}

/**
 * "Path /api/orders/42 · Last hour": what narrows the rows besides the link
 * the title names.
 */
function describe(current: LogsFilters): string {
  return [
    current.route && current.path
      ? t('api.logs.empty.path', { path: current.path })
      : undefined,
    ...describeFilters(current),
  ]
    .filter(Boolean)
    .join(' · ')
}

function go(query: Record<string, string>) {
  void router.push({ query })
}

function clearFilters() {
  return {
    label: t('dms.table.clear_filters'),
    icon: 'i-ph-x',
    color: 'neutral' as const,
    variant: 'outline' as const,
    onClick: () => go(clearedLogsFilters(route.query)),
  }
}

function clearSearchAction() {
  const clear = props.clearSearch
  if (!clear) return []
  return [
    {
      label: t('dms.table.clear_search'),
      icon: 'i-ph-x',
      color: 'neutral' as const,
      variant: 'outline' as const,
      onClick: () => clear(),
    },
  ]
}

function widen() {
  if (isAllTime(period.value)) return []
  return [
    {
      label: t('api.logs.empty.widen'),
      icon: 'i-ph-arrows-out-line-horizontal',
      color: 'neutral' as const,
      variant: 'outline' as const,
      onClick: () => go(withLogsFilters(route.query, { allTime: true })),
    },
  ]
}

const content = computed(() => {
  const current = filters.value
  const narrowed = describe(current)
  const narrowedLine = narrowed
    ? t('api.logs.empty.narrowed', { filters: narrowed })
    : ''
  switch (cause.value) {
    case 'error':
      return {
        variant: 'error' as const,
        icon: 'i-ph-warning-circle',
        title: t('api.logs.empty.error_title'),
        description: t('api.logs.empty.error_description'),
        actions: [
          {
            label: t('dms.table.load_error_retry'),
            icon: 'i-ph-arrow-clockwise',
            color: 'neutral' as const,
            variant: 'outline' as const,
            onClick: () => props.refresh?.(),
          },
        ],
      }
    case 'search':
      return {
        variant: 'no-result' as const,
        icon: 'i-ph-magnifying-glass',
        title: t('api.logs.empty.search_title', { search: props.search }),
        description: [t('api.logs.empty.search_description'), narrowedLine]
          .filter(Boolean)
          .join(' '),
        actions: [
          ...clearSearchAction(),
          ...widen(),
          ...(hasLogsFilters(current) ? [clearFilters()] : []),
        ],
      }
    case 'link':
      return {
        variant: 'no-result' as const,
        icon: 'i-ph-link-simple',
        title: current.route
          ? t('api.logs.empty.route_title', {
              route: current.route,
            })
          : current.path
            ? t('api.logs.empty.route_title', { route: current.path })
            : current.error
              ? t('api.logs.empty.error_filter_title')
              : t('api.logs.empty.incident_title'),
        description: [t('api.logs.empty.link_description'), narrowedLine]
          .filter(Boolean)
          .join(' '),
        actions: [
          {
            label: t('api.logs.empty.remove_link'),
            icon: 'i-ph-x',
            color: 'neutral' as const,
            variant: 'outline' as const,
            onClick: () =>
              go(
                withLogsFilters(route.query, {
                  route: null,
                  path: null,
                  error: null,
                  incident: null,
                }),
              ),
          },
          ...(describeFilters(current).length ? [clearFilters()] : []),
        ],
      }
    case 'filters':
      return {
        variant: 'no-result' as const,
        icon: 'i-ph-funnel',
        title: t('api.logs.empty.filtered_title'),
        description: [
          narrowedLine,
          isAllTime(period.value) ? '' : t('api.logs.empty.period_hint'),
        ]
          .filter(Boolean)
          .join(' '),
        actions: [
          ...widen(),
          ...(hasLogsFilters(current) ? [clearFilters()] : []),
        ],
      }
    default:
      return {
        variant: 'no-data' as const,
        icon: 'i-ph-broadcast',
        title: t('api.logs.empty.first_run_title'),
        description: t('api.logs.empty.first_run_description'),
        actions: [
          {
            label: t('api.logs.empty.browse_routes'),
            icon: 'i-ph-tree-structure',
            color: 'neutral' as const,
            variant: 'outline' as const,
            to: '/modules/api/routes',
          },
        ],
      }
  }
})
</script>

<template>
  <DmsEmptyState
    :variant="content.variant"
    :icon="content.icon"
    :title="content.title"
    :description="content.description"
    :actions="content.actions"
    size="lg"
    hatched
    class="z-10 w-full"
  />
</template>
