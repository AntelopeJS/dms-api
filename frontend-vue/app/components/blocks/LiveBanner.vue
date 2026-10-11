<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  toRaw,
  useTemplateRef,
  watch,
} from 'vue'
import { formatCount } from '../../utils/format'
import { hasPending } from '../../utils/liveMode'
import {
  BANNER_ATTRIBUTE,
  cardAfter,
  refreshTable,
  scrollAreaTop,
} from '../../utils/liveTable'
import { shownTab } from '../../utils/logsQuery'

// Right before a request table: "↑ 12 new requests · 3 in 5xx · Show" while
// the table does not take new rows in — the page paused, or the table held
// by what the user does (a search, a sort, more rows loaded, reading further
// down the request logs). Show reads the table again. It tells the page's
// `LiveControl` how the table pages and scrolls, and marks where the table
// is: the control finds it right after, rows or not. The banner floats: it
// takes no room in the page, so its coming moves no row. Over the gap above
// the table while that is in view, at the top of the screen, over the table,
// once the user reads further down.
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    pageSize: number
    followScroll?: boolean
    pageId?: string
    componentId?: string
  }>(),
  { followScroll: false, pageId: undefined, componentId: undefined },
)

/** Room between the top of the scroll area and the floating banner. */
const FLOAT_GAP_PX = 12

const { t } = useI18n()
const locale = useFormatLocale()
const { state, tableLive } = useLiveMode()

const count = (value: number) => formatCount(value, locale.value)

const pending = computed(() => state.value.pending)
const shown = computed(
  () => state.value.ready && !tableLive.value && hasPending(pending.value),
)

const table = { pageSize: props.pageSize, followScroll: props.followScroll }

// Where the banner floats once its place has scrolled out of view: centred
// over the table, under the top of the scroll area, while some of the table
// is still in view (the Overview goes on below it).
const anchor = useTemplateRef<HTMLElement>('anchor')
const floating = ref<{ top: number; left: number; width: number } | null>(null)

function place() {
  const element = anchor.value
  if (!element || !shown.value) {
    floating.value = null
    return
  }
  const top = scrollAreaTop(element) + FLOAT_GAP_PX
  const rect = element.getBoundingClientRect()
  const card = cardAfter(element)
  const tableInView = !!card && card.getBoundingClientRect().bottom > top
  floating.value =
    rect.top < top && tableInView
      ? { top, left: rect.left, width: rect.width }
      : null
}

let frame = 0
function schedulePlace() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    place()
  })
}

watch(shown, () => place(), { flush: 'post' })

// While the table does not move, a tab chosen reads its rows anew, but the
// DMS table keeps the tab counts it read with them last ("4xx 505" over
// "50 of 502"): the counts come from their own requests, read again only
// with the whole table (`countBatch`). The table's refresh reads both, so the
// counts match the rows shown again.
let tabsObserver: MutationObserver | undefined
function followTabs() {
  const card = anchor.value && cardAfter(anchor.value)
  if (!card) return
  let tab = shownTab(card)
  tabsObserver = new MutationObserver(() => {
    const next = shownTab(card)
    if (next === tab) return
    tab = next
    if (!tableLive.value) refreshTable({ card, ...table })
  })
  tabsObserver.observe(card, {
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-current'],
  })
}

onMounted(() => {
  state.value.table = table
  // Captured: the page scrolls in its panel, not the window.
  window.addEventListener('scroll', schedulePlace, {
    capture: true,
    passive: true,
  })
  window.addEventListener('resize', schedulePlace, { passive: true })
  followTabs()
})
// The banner of the page shown next may already have taken its place.
onBeforeUnmount(() => {
  if (toRaw(state.value.table) === table) state.value.table = null
  window.removeEventListener('scroll', schedulePlace, { capture: true })
  window.removeEventListener('resize', schedulePlace)
  cancelAnimationFrame(frame)
  tabsObserver?.disconnect()
})

function show() {
  sendLiveCommand('show')
}
</script>

<template>
  <div
    ref="anchor"
    v-bind="{ [BANNER_ATTRIBUTE]: '' }"
    role="status"
    class="relative h-0"
  >
    <div
      v-if="shown"
      class="z-20 flex justify-center"
      :class="
        floating
          ? 'pointer-events-none fixed'
          : 'pointer-events-none absolute inset-x-0 top-0 -translate-y-1/2'
      "
      :style="
        floating
          ? {
              top: `${floating.top}px`,
              left: `${floating.left}px`,
              width: `${floating.width}px`,
            }
          : undefined
      "
    >
      <div
        class="border-default bg-default pointer-events-auto flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-full border px-4 py-1.5 text-[13px] shadow-md"
      >
        <UIcon name="i-ph-arrow-up" class="text-primary size-3.5 shrink-0" />
        <span class="text-highlighted font-medium">
          {{
            t(
              'api.live_mode.new_requests',
              { count: count(pending.count) },
              pending.count,
            )
          }}
        </span>
        <span v-if="pending.serverErrors > 0" class="text-error font-mono">
          ·
          {{
            t('api.live_mode.server_errors', {
              count: count(pending.serverErrors),
            })
          }}
        </span>
        <span v-if="pending.tester > 0" class="text-muted">
          ·
          {{
            t(
              'api.live_mode.tester',
              { count: count(pending.tester) },
              pending.tester,
            )
          }}
        </span>
        <UButton
          size="xs"
          color="primary"
          variant="link"
          class="px-0"
          :label="t('api.live_mode.show')"
          @click="show"
        />
      </div>
    </div>
  </div>
</template>
