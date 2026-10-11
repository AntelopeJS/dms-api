<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  dayStarts,
  listedRequestIds,
  navigationAmong,
  OPEN_REQUEST_EVENT,
  readLocationRecord,
  readRecord,
  REQUEST_ACTION_SELECTOR,
  REQUEST_PANEL_ID,
  requestActionSelector,
  type RowNavigation,
  useRequestPanel,
  writeRecord,
} from '../../utils/requestDrawer'

// The request tables' companion on a page: it shows nothing itself. It opens
// the request the URL names (`?record=`) in the DMS side panel on the right
// (`RequestDetail.vue`), docked next to the page from `lg`: the rows stay in
// view and clickable, the open one highlighted and scrolled into view. A
// click on a row opens it; J and K step through the rows as the table shows
// them; Esc or ✕ closes, and the focus goes back to the row.
//
// Neither opening nor closing visits the page or adds a history entry
// (`writeRecord`, `utils/requestDrawer.ts`): the page is never mounted anew
// under the panel, its loaded rows, scroll, pause and focus stay. Back
// leaves the page, as it did before the panel opened.
defineOptions({ inheritAttrs: false })

/** How long the table settles before the panel follows it. */
const FOLLOW_DELAY_MS = 120
/** The row of the open request. */
const OPEN_ROW_ATTRIBUTE = 'data-dms-api-open-row'
/** A row starting a day, in a table that runs through time. */
const DAY_START_ATTRIBUTE = 'data-dms-api-day-start'
/** A time cell's day (`plugins/displays.ts`). */
const DAY_ATTRIBUTE = 'data-dms-api-day'
/** What a click on a row leaves to the element it lands on. */
const INTERACTIVE =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="menuitem"], [role="checkbox"], [contenteditable="true"]'
/**
 * Open layers that take Esc for themselves: a menu, a listbox, a modal or a
 * popover (open, as reka marks it), a dialog holding the focus. Not a card
 * that only calls itself a dialog, like the DMS's "Enjoying the AntelopeJS
 * DMS?", shown on every page until dismissed.
 */
const LAYERS =
  '[role="menu"], [role="listbox"], [role="dialog"][data-state="open"], [role="dialog"][aria-modal="true"], [role="dialog"]:focus-within'

// Read through the router, not `useDmsRoute()`: each call of it reassigns
// the route's query, which the request tables watch for their filters.
const router = useDmsRouter()
const sidePanel = useSidePanel(REQUEST_PANEL_ID)
const panel = useRequestPanel()

const host = ref<HTMLElement | null>(null)
// A string: only another request asked for opens anything.
const asked = ref<string | null>(null)

// A deep-linked request closed in place: the page Inertia holds still names
// it, so a visit built on that page's query (a tab, a filter) would bring it
// back. It is dropped again until a visit no longer carries it.
let dismissed: string | null = null
// The panel takes the focus once it shows the request a row asked for.
let takeFocus = false
// The request the panel's J / K were worked out for.
let navigated: string | null = null
// The request whose row is scrolled into view once the table shows it.
let reveal: string | null = null
// Set once this instance is gone: nothing it scheduled may act after.
let disposed = false

function readAsked() {
  return readLocationRecord(window.location.href)
}

// --- where the rows are ---
// The page's own: the panel, outside it, holds none.
function rows(): ParentNode {
  return host.value?.closest('.dms-page-stack') ?? document
}

function rowOf(id: string): HTMLElement | null {
  return (
    rows()
      .querySelector<HTMLElement>(requestActionSelector(id))
      ?.closest('tr') ?? null
  )
}

function markOpenRow(id: string | null) {
  const row = id ? rowOf(id) : null
  for (const marked of document.querySelectorAll(`[${OPEN_ROW_ATTRIBUTE}]`)) {
    if (marked === row) continue
    marked.removeAttribute(OPEN_ROW_ATTRIBUTE)
    marked.removeAttribute('aria-current')
  }
  row?.setAttribute(OPEN_ROW_ATTRIBUTE, '')
  row?.setAttribute('aria-current', 'true')
  // J / K, a deep link: the open row stays in sight, the page moving only
  // as far as it must.
  if (row && id === reveal) {
    reveal = null
    row.scrollIntoView({ block: 'nearest' })
  }
}

// A line between the days of a table sorted on time: 17:02 then 02:39 reads
// as a jump only once "Yesterday" sits between them.
function markDays() {
  for (const table of rows().querySelectorAll('table')) {
    const cells = [...table.querySelectorAll(`[${DAY_ATTRIBUTE}]`)]
    const lines = cells.map((cell) => cell.closest('tr'))
    const starts = new Set(
      dayStarts(cells.map((cell) => cell.getAttribute(DAY_ATTRIBUTE) ?? '')),
    )
    lines.forEach((line, index) => {
      if (starts.has(index)) line?.setAttribute(DAY_START_ATTRIBUTE, '')
      else line?.removeAttribute(DAY_START_ATTRIBUTE)
    })
  }
}

function placementOf(navigation: RowNavigation | null): string {
  return navigation ? `${navigation.index}|${navigation.total}` : ''
}

// The open request's place among the rows, as the table shows them now. A
// row gone from the table (a live list, a page loaded under it) leaves the
// panel with the rows it had.
function follow() {
  const id = asked.value
  if (!id) return
  markOpenRow(id)
  const navigation = navigationAmong(listedRequestIds(rows()), id, step)
  if (!navigation && navigated === id) return
  if (
    navigated === id &&
    placementOf(navigation) === placementOf(panel.value.navigation)
  )
    return
  navigated = id
  panel.value = { ...panel.value, navigation }
}

// --- the table changing ---
// Its rows arriving after a deep link, a refresh, more rows loaded: the
// highlight, the day lines and J / K follow.
let observer: MutationObserver | null = null
let timer: ReturnType<typeof setTimeout> | undefined

function settleRows() {
  timer = undefined
  if (disposed) return
  markDays()
  follow()
}

function watchRows() {
  if (typeof MutationObserver === 'undefined') return
  const root = rows()
  observer = new MutationObserver(() => {
    timer ??= setTimeout(settleRows, FOLLOW_DELAY_MS)
  })
  observer.observe(root === document ? document.body : (root as Node), {
    childList: true,
    subtree: true,
  })
  settleRows()
}

// --- opening and closing ---
function open(id: string) {
  panel.value = {
    ...panel.value,
    hosted: true,
    id,
    close: closeRequest,
    focus: takeFocus || panel.value.focus,
  }
  takeFocus = false
  reveal = id
  sidePanel.open()
  follow()
}

// Whether the focus leaves with the panel: in it (✕, its tabs, its heading
// after J / K), or lost. Focus elsewhere on the page is the user's.
function focusLeaves(): boolean {
  const active = document.activeElement
  if (!active || active === document.body) return true
  const page = rows()
  return page !== document && !(page as Node).contains(active)
}

function shut(previous: string | null) {
  const refocus = previous !== null && focusLeaves()
  navigated = null
  reveal = null
  panel.value = { ...panel.value, id: null, navigation: null }
  sidePanel.close()
  markOpenRow(null)
  if (!refocus) return
  // Once the panel left the page: the DMS gives the focus back first, to
  // where it was when the panel opened, not to the row J / K reached.
  void nextTick(() => {
    if (!disposed)
      rows()
        .querySelector<HTMLElement>(requestActionSelector(previous))
        ?.focus()
  })
}

watch(asked, (id, previous) => {
  if (disposed) return
  if (id) open(id)
  else shut(previous)
})

/**
 * The user closes the panel (✕, Esc, the sheet's backdrop): the request
 * leaves the URL in place, never by going back, which Inertia would answer
 * by mounting the page anew.
 */
function closeRequest() {
  const id = asked.value
  if (disposed || !id) return
  asked.value = null
  if (!readAsked()) return
  if (readRecord(router.currentRoute.value.query) === id) dismissed = id
  writeRecord()
}

// The next request shows at once; the URL follows.
function step(id: string) {
  if (disposed) return
  writeRecord(id)
  asked.value = id
}

// The DMS closed the panel: its backdrop or Esc below `lg`, another panel.
watch(sidePanel.isOpen, (isOpen) => {
  if (!isOpen && asked.value) closeRequest()
})

// A row opened a request (`openRequestMiddleware`).
function onOpenRequest() {
  const id = readAsked()
  takeFocus = id !== asked.value
  dismissed = null
  asked.value = id
}

// A visit (a link, a filter written to the URL, Back to an entry of this
// page) names its own request.
watch(
  () => router.currentRoute.value.fullPath,
  () => {
    const id = readAsked()
    if (id !== null && id === dismissed) {
      writeRecord()
      asked.value = null
      return
    }
    dismissed = null
    asked.value = id
  },
)

// A click on a row opens it, as its action button does; a click on what the
// row holds (a copy button, a link) or a text selection is left alone.
function onRowClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const target = event.target as Element | null
  if (!target || target.closest(INTERACTIVE)) return
  if (window.getSelection()?.toString()) return
  target
    .closest('tr')
    ?.querySelector<HTMLButtonElement>(REQUEST_ACTION_SELECTOR)
    ?.click()
}

// A key typed into a field is text, not a step.
function onKey(event: KeyboardEvent) {
  if (!asked.value || event.defaultPrevented) return
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"]'))
    return
  if (event.key === 'Escape') {
    if (document.querySelector(LAYERS)) return
    closeRequest()
    event.preventDefault()
    return
  }
  const navigation = panel.value.navigation
  const key = event.key.toLowerCase()
  if (key === 'j' && navigation?.hasNext) navigation.next()
  else if (key === 'k' && navigation?.hasPrev) navigation.prev()
  else return
  event.preventDefault()
}

let clickRoot: Node | null = null

onMounted(() => {
  window.addEventListener(OPEN_REQUEST_EVENT, onOpenRequest)
  window.addEventListener('keydown', onKey)
  const root = rows()
  clickRoot = root === document ? document : (root as Node)
  clickRoot.addEventListener('click', onRowClick as EventListener)
  panel.value = { ...panel.value, hosted: true, close: closeRequest }
  asked.value = readAsked()
  // A panel left open by an earlier page (its state is a cookie).
  if (!asked.value) sidePanel.close()
  watchRows()
})

onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener(OPEN_REQUEST_EVENT, onOpenRequest)
  window.removeEventListener('keydown', onKey)
  clickRoot?.removeEventListener('click', onRowClick as EventListener)
  observer?.disconnect()
  clearTimeout(timer)
  markOpenRow(null)
  panel.value = {
    hosted: false,
    id: null,
    navigation: null,
    focus: false,
    close: null,
  }
  sidePanel.close()
})
</script>

<template>
  <span ref="host" data-dms-api-request-drawer-host hidden />
</template>

<style>
/* The page spaces its blocks: this one takes no room. */
.dms-page-stack > :has(> [data-dms-api-request-drawer-host]) {
  display: none;
}

/* A request table's row opens its request on a click. */
.dms-page-stack tr:has(button[id^='row-action-'][id$='-i-ph-sidebar-simple']) {
  cursor: pointer;
}

/* The row the panel shows. */
.dms-page-stack tr[data-dms-api-open-row] > td {
  background-color: color-mix(in oklab, var(--ui-primary) 9%, var(--ui-bg));
}

.dms-page-stack tr[data-dms-api-open-row] > td:first-child {
  box-shadow: inset 2px 0 0 var(--ui-primary);
}

/* The first row of a day, in a table sorted on time. */
.dms-page-stack tr[data-dms-api-day-start] > td {
  border-top: 1px solid var(--ui-border-accented);
}
</style>
