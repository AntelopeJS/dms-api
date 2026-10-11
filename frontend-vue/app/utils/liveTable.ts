// The request table of a live page, as the page's `LiveControl` reads it from
// the DOM. A DMS `TableView.fromSource` keeps its sort, search and loaded rows
// to itself and has no realtime of its own: the control finds the table right
// after the page's `LiveBanner`, reads what it shows, and refreshes it through
// the page (`refreshPageBlocks`, which a TableView listens to) or its own
// Refresh button.

import {
  HIGHLIGHT_MS,
  isCustomSort,
  isTypingTarget,
  latestTime,
  type TableSnapshot,
} from './liveMode'
import {
  listedRequestIds,
  REQUEST_ACTION_SELECTOR,
  requestActionSelector,
} from './requestDrawer'

/** A time cell's moment, in ISO (`plugins/displays.ts`). */
export const TIME_ATTRIBUTE = 'data-dms-api-time'

/** Marks the Tester's form (`RouteTester.vue`): typing in it pauses the page. */
const TESTER_ATTRIBUTE = 'data-dms-api-tester'

/**
 * Marks the place of the page's `LiveBanner`, drawn right before the request
 * table even while it shows nothing: the table is the first card after it.
 */
export const BANNER_ATTRIBUTE = 'data-dms-api-live-banner'

/** The card frame of a DMS table. */
const CARD_SELECTOR = '.dms-card'

/** A row taken in live, highlighted a moment. */
const NEW_ROW_CLASS = 'dms-api-live-new'

/** How long a refresh is watched for the rows it brings. */
const NEW_ROWS_WATCH_MS = 6000

export interface LiveTable {
  /** The table's card: its toolbar, rows and footer. */
  card: HTMLElement
  /** Rows of its first page. */
  pageSize: number
  /** The table is the page: it takes rows in only while at its top. */
  followScroll: boolean
}

/** Where the page's `LiveBanner` says its table stands. */
export interface LiveTableOptions {
  pageSize: number
  followScroll: boolean
}

/** The part of an element `cardAfter` walks: its next siblings, its parent. */
export interface WalkedElement {
  parentElement: WalkedElement | null
  nextElementSibling: WalkedElement | null
  matches: (selector: string) => boolean
  querySelector: (selector: string) => unknown
}

/** The first card after `anchor` in the page, its own or a following block's. */
export function cardAfter<T extends WalkedElement>(anchor: T): T | null {
  for (let node: WalkedElement | null = anchor; node; node = node.parentElement)
    for (
      let next = node.nextElementSibling;
      next;
      next = next.nextElementSibling
    ) {
      if (next.matches(CARD_SELECTOR)) return next as T
      const card = next.querySelector(CARD_SELECTOR)
      if (card) return card as T
    }
  return null
}

/**
 * The page's request table: the card right after its banner, which is there
 * whether the table holds rows or not (an empty search result still holds
 * the page); else the card holding the rows.
 */
export function findLiveTable(
  options: LiveTableOptions,
  root: ParentNode = document,
): LiveTable | null {
  const anchor = root.querySelector<HTMLElement>(`[${BANNER_ATTRIBUTE}]`)
  const card =
    (anchor && cardAfter(anchor)) ??
    root
      .querySelector(REQUEST_ACTION_SELECTOR)
      ?.closest<HTMLElement>(CARD_SELECTOR)
  return card ? { card, ...options } : null
}

function sortedHeaders(card: HTMLElement) {
  const timeCell = card
    .querySelector(`tbody [${TIME_ATTRIBUTE}]`)
    ?.closest<HTMLTableCellElement>('td')
  const timeIndex = timeCell ? timeCell.cellIndex : -1
  return [...card.querySelectorAll<HTMLTableCellElement>('thead th')].map(
    (header) => ({
      sort: header.getAttribute('aria-sort'),
      time: header.cellIndex === timeIndex,
    }),
  )
}

/**
 * The search typed in the table's toolbar, if any: the count of what
 * arrived (`/since?search=`) keeps to it as the rows do.
 */
export function tableSearch(table: LiveTable | null): string | null {
  const search = table?.card.querySelector<HTMLInputElement>('header input')
  return search?.value.trim() || null
}

/** What the table shows: its rows, its sort, its search. */
export function snapshotTable(table: LiveTable): TableSnapshot {
  const { card } = table
  // By the headers, not the DMS's own "custom sort" mark: with no sort at
  // all, the route lists newest first, which the mark calls custom.
  return {
    rows: listedRequestIds(card).length,
    pageSize: table.pageSize,
    customSort: isCustomSort(sortedHeaders(card)),
    search: tableSearch(table) !== null,
  }
}

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (
      /(auto|scroll)/.test(overflowY) &&
      node.scrollHeight > node.clientHeight
    )
      return node
  }
  return null
}

/**
 * The top of the area `element` scrolls in, in viewport pixels: what a
 * banner floating over the page stays under.
 */
export function scrollAreaTop(element: HTMLElement): number {
  const scroller = scrollParent(element)
  return Math.max(scroller ? scroller.getBoundingClientRect().top : 0, 0)
}

/** Whether the table's first row is in view: the user reads its top. */
export function firstRowInView(table: LiveTable): boolean {
  const row = table.card.querySelector('tbody tr')
  if (!row) return true
  const scroller = scrollParent(table.card)
  const top = scroller ? scroller.getBoundingClientRect().top : 0
  return row.getBoundingClientRect().bottom > top + 1
}

/** The newest request the table shows (ISO), if it shows any. */
export function newestRow(table: LiveTable): string | null {
  return latestTime(
    [...table.card.querySelectorAll(`[${TIME_ATTRIBUTE}]`)].map((cell) =>
      cell.getAttribute(TIME_ATTRIBUTE),
    ),
  )
}

/** The status tab the table shows (`2xx`…), from its tabs' labels. */
export function activeTab(table: LiveTable): string | null {
  const label = table.card
    .querySelector('[aria-current="true"]')
    ?.textContent?.trim()
  return label ? label.slice(0, 3) : null
}

/** Reads the table again by its own Refresh button, when it shows one. */
export function refreshTable(table: LiveTable | null): boolean {
  const button =
    table?.card.querySelector<HTMLButtonElement>('#refresh-trigger')
  if (!button) return false
  button.click()
  return true
}

/** The ids of the rows on screen. */
export function rowIds(table: LiveTable | null): Set<string> {
  return new Set(table ? listedRequestIds(table.card) : [])
}

function markNew(card: HTMLElement, ids: string[]) {
  for (const id of ids) {
    const row = card.querySelector(requestActionSelector(id))?.closest('tr')
    if (!row) continue
    row.classList.add(NEW_ROW_CLASS)
    setTimeout(() => row.classList.remove(NEW_ROW_CLASS), HIGHLIGHT_MS)
  }
}

/**
 * Highlights the rows the table's next listing brings, the ones `before`
 * did not hold. Watches the table a few seconds; returns the stop.
 */
export function highlightNewRows(
  table: LiveTable,
  before: Set<string>,
): () => void {
  if (before.size === 0) return () => {}
  const { card } = table
  let timer: ReturnType<typeof setTimeout> | undefined
  const observer = new MutationObserver(() => {
    const ids = listedRequestIds(card)
    const fresh = ids.filter((id) => !before.has(id))
    if (fresh.length === 0) return
    stop()
    markNew(card, fresh)
  })
  function stop() {
    observer.disconnect()
    clearTimeout(timer)
  }
  observer.observe(card, { childList: true, subtree: true })
  timer = setTimeout(stop, NEW_ROWS_WATCH_MS)
  return stop
}

/** Whether the focus is in a field of the Tester: the user is typing there. */
export function typingInTester(element: Element | null): boolean {
  return !!element?.closest(`[${TESTER_ATTRIBUTE}]`) && isTypingTarget(element)
}
