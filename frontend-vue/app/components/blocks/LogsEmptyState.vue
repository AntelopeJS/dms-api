<script setup lang="ts">
import {
  computed,
  inject,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  type ComponentPublicInstance,
  type Ref,
} from 'vue'
import {
  ALL_LOG_WINDOW,
  clearedLogsFilters,
  hasIncident,
  hasLogsFilters,
  logsEmptyCause,
  readLogsFilters,
  shownTab,
  withDefaultWindow,
  withLogsFilters,
  type LogsFilters,
} from '../../utils/logsQuery'

// The request table's empty body, which names what empties it: the search,
// a link's filters, the period and the other filters of the URL (the DMS
// table does not count those as filters), else nothing captured yet. Each
// cause comes with its way out. The table hands it `state`, `search` and
// `refresh`.
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  state?: 'firstRun' | 'filtered' | 'error'
  search?: string
  refresh?: () => void
}>()

const { t } = useI18n()
const route = useDmsRoute()
const router = useDmsRouter()

// The DMS table shares its search with what it draws: clearing it from here
// folds the toolbar's field like its own "Clear search" does.
const table = inject<
  Ref<{ globalFilterState?: Ref<string | undefined> }> | undefined
>('tableSharedData', undefined)

// The status tab, which empties the table as much as the URL's filters: the
// DMS table does not share it, it is read from the tabs of the card this
// body is drawn in, and followed while it shows.
const ALL_TAB = 'all'
const CARD_SELECTOR = '.dms-card'
const TAB_SELECTOR = '[aria-current="true"]'
const body = useTemplateRef<ComponentPublicInstance>('body')
const card = ref<HTMLElement | null>(null)
const tab = ref<string>()
let tabsObserver: MutationObserver | undefined

onMounted(() => {
  card.value = (body.value?.$el as HTMLElement | undefined)?.closest?.(
    CARD_SELECTOR,
  ) as HTMLElement | null
  if (!card.value) return
  const read = () => (tab.value = shownTab(card.value!))
  read()
  tabsObserver = new MutationObserver(read)
  tabsObserver.observe(card.value, {
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-current'],
  })
})
onBeforeUnmount(() => tabsObserver?.disconnect())

/** Shows the "All" tab: the first of the card's tabs. */
function showAllTabs() {
  const tabs = card.value?.querySelector(TAB_SELECTOR)?.parentElement
  ;(tabs?.firstElementChild as HTMLElement | null)?.click()
}

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
 * "5xx tab · Path /api/orders/42 · Last hour": what narrows the rows besides
 * the link the title names, the tab first.
 */
function describe(current: LogsFilters): string {
  return [
    tab.value && tab.value !== ALL_TAB
      ? t('api.logs.empty.tab', { tab: tab.value })
      : undefined,
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
    label: t('api.logs.empty.clear_filters'),
    icon: 'i-ph-x',
    color: 'neutral' as const,
    variant: 'outline' as const,
    onClick: () => go(clearedLogsFilters(route.query)),
  }
}

// Every status, while a tab narrows the rows.
function allTabs() {
  if (!tab.value || tab.value === ALL_TAB) return []
  return [
    {
      label: t('api.logs.empty.show_all_tabs'),
      icon: 'i-ph-list',
      color: 'neutral' as const,
      variant: 'outline' as const,
      onClick: showAllTabs,
    },
  ]
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

function clearSearch() {
  const search = table?.value?.globalFilterState
  if (!search) return []
  return [
    {
      label: t('api.logs.empty.clear_search'),
      icon: 'i-ph-x',
      color: 'neutral' as const,
      variant: 'outline' as const,
      onClick: () => {
        search.value = ''
      },
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
            label: t('api.common.retry'),
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
          ...clearSearch(),
          ...allTabs(),
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
          ...allTabs(),
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
          ...allTabs(),
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
    ref="body"
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
