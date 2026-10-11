<script setup lang="ts">
import { computed } from 'vue'
import {
  ALL_LOG_WINDOW,
  clearedLogsFilters,
  hasIncident,
  hasLogsFilters,
  logsEmptyCause,
  readLogsFilters,
  withDefaultWindow,
  withLogsFilters,
  type LogsFilters,
} from '../../utils/logsQuery'

// The request table's empty body, which names what empties it: the search,
// a link's filters, the period and the other filters of the URL (the DMS
// table does not count those as filters), else nothing captured yet. Each
// cause comes with its way out. The table hands it `state`, `search` and
// `refresh`; its tab and its search field are its own, cleared from its own
// toolbar.
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  state?: 'firstRun' | 'filtered' | 'error'
  search?: string
  refresh?: () => void
}>()

const { t } = useI18n()
const route = useDmsRoute()
const router = useDmsRouter()

// With the period the table applies when the URL names none.
const filters = computed(() => withDefaultWindow(readLogsFilters(route.query)))
const cause = computed(() =>
  logsEmptyCause(props.state, props.search, filters.value),
)

/** "Last hour · POST · Slow only": the URL's filters, besides the links. */
function describeFilters(current: LogsFilters): string[] {
  return [
    current.window && current.window !== ALL_LOG_WINDOW && !hasIncident(current)
      ? t(`api.logs.windows.${current.window}`)
      : undefined,
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

// Every period, while a narrower one may hide the requests.
function widen() {
  const current = filters.value
  if (current.window === ALL_LOG_WINDOW || hasIncident(current)) return []
  return [
    {
      label: t('api.logs.empty.widen'),
      icon: 'i-ph-arrows-out-line-horizontal',
      color: 'neutral' as const,
      variant: 'outline' as const,
      onClick: () =>
        go(withLogsFilters(route.query, { window: ALL_LOG_WINDOW })),
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
          current.window !== ALL_LOG_WINDOW
            ? t('api.logs.empty.period_hint')
            : '',
        ]
          .filter(Boolean)
          .join(' '),
        // The default period alone is nothing to clear.
        actions: [
          ...widen(),
          ...(hasLogsFilters(readLogsFilters(route.query))
            ? [clearFilters()]
            : []),
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
