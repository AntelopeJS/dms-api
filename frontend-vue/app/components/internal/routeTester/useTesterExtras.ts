import { computed, onBeforeUnmount } from 'vue'
import {
  byteLength,
  formatBytes,
  formatMs,
  prettyBody,
} from '../../../utils/format'
import { statusText } from '../../../utils/http'
import { toCurl } from '../../../utils/snippets'
import {
  HISTORY_MAX,
  type HistoryEntry,
  loadHistory,
  saveHistory,
} from '../../../utils/testerHistory'
import {
  PROXY_RESPONSE_LIMIT,
  PROXY_TIMEOUT_MS,
  revealBidi,
} from '../../../utils/testerRequest'
import type { useTesterFlow } from './useTesterFlow'
import type { useTesterState } from './useTesterState'

/**
 * The rest of the tester, as `RouteTester` sets it up last: history, cURL,
 * the keyboard, the live hold and the answer.
 */
export function useTesterExtras(
  tester: ReturnType<typeof useTesterState> & ReturnType<typeof useTesterFlow>,
) {
  const {
    LOGS_PAGE,
    ERROR_ICONS,
    POINTS_TO_CAPTURED,
    toast,
    apiOrigin,
    body,
    query,
    pathValues,
    origin,
    replayInfo,
    result,
    history,
    sending,
    method,
    sentBody,
    effectiveHeaders,
    auth,
    formattedBody,
    routeCaptured,
    t,
    locale,
    route,
    session,
    applyRequest,
    warnLostSecrets,
    flushDraft,
    send,
    showResult,
  } = tester
  // --- History ---

  function restore(entry: HistoryEntry) {
    applyRequest(entry.request)
    origin.value = 'history'
    replayInfo.value = null
    showResult(entry.result)
    warnLostSecrets([
      ...(entry.secretsRemoved ?? []),
      ...(entry.result.secrets ?? []),
    ])
  }

  function clearHistory() {
    const ref = session.activeRef
    if (!ref) return
    const cleared = history.value
    history.value = []
    saveHistory(ref, [])
    toast.add({
      title: t(
        'api.tester.history_cleared',
        { count: cleared.length },
        cleared.length,
      ),
      color: 'neutral',
      icon: 'i-ph-trash',
      actions: [
        {
          label: t('api.tester.undo'),
          color: 'neutral',
          variant: 'outline',
          onClick: () => {
            const merged = [...loadHistory(ref), ...cleared].slice(
              0,
              HISTORY_MAX,
            )
            saveHistory(ref, merged)
            if (session.activeRef === ref) history.value = merged
          },
        },
      ],
    })
  }

  // --- Copy cURL ---

  function curl(): string {
    const search: Record<string, string | string[]> = {}
    for (const { name, value } of query) {
      if (!name) continue
      const known = search[name]
      search[name] = known === undefined ? value : [...[known].flat(), value]
    }
    return toCurl({
      method: method.value,
      path: route.value?.path ?? '/',
      origin: apiOrigin.value,
      pathParams: { ...pathValues },
      query: search,
      headers: effectiveHeaders.value,
      body: sentBody.value,
      session: auth.value === 'session',
    })
  }

  async function copyCurl() {
    try {
      await navigator.clipboard.writeText(curl())
      toast.add({
        title: t('api.request.curl_copied'),
        color: 'success',
        icon: 'i-ph-check',
      })
    } catch {
      toast.add({
        title: t('api.request.copy_failed'),
        color: 'error',
        icon: 'i-ph-warning',
      })
    }
  }

  /** What the user typed in the body editor (not a body loaded into it). */
  function editBody(value: string | null | undefined) {
    const next = value ?? ''
    if (next === body.value) return
    body.value = next
    origin.value = 'edited'
  }

  function formatBody() {
    if (formattedBody.value === null) return
    body.value = formattedBody.value
    origin.value = 'edited'
  }

  // --- Keyboard ---

  /**
   * Ctrl/Cmd+Enter sends from a field of the tester only, never from the rest
   * of the page (the route filter, the command palette); `send` still asks
   * before a write it has not confirmed.
   */
  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
    if (event.isComposing) return
    event.preventDefault()
    void send()
  }

  // --- Live hold ---

  const FIELD_SELECTOR = 'input, textarea, select, [contenteditable="true"]'
  const live = usePageLive()

  function onFocusIn(event: FocusEvent) {
    const target = event.target as HTMLElement | null
    if (target?.closest(FIELD_SELECTOR))
      live.hold('$api.live_mode.typing_in_tester')
  }

  // Held while the focus stays in the Tester (a field, Send), released once it
  // leaves; the DMS releases it with the component too.
  function onFocusOut(event: FocusEvent) {
    const root = event.currentTarget as HTMLElement
    const next = event.relatedTarget as Node | null
    if (next && root.contains(next)) return
    live.release()
  }

  onBeforeUnmount(() => {
    flushDraft()
    // A call in flight still lands in its route's history and draft.
    session.unmounted = true
  })

  // --- Answer ---

  const responseBody = computed(() => prettyBody(result.value?.body))
  const responseSize = computed(() =>
    result.value ? (result.value.bodySize ?? byteLength(result.value.body)) : 0,
  )
  function recordLink(id: string): string {
    return `${LOGS_PAGE}?${new URLSearchParams({ record: id })}`
  }

  /** A path as it reads: decoded, its bidirectional controls shown. */
  function readable(value: string): string {
    try {
      return revealBidi(decodeURI(value))
    } catch {
      return revealBidi(value)
    }
  }

  /**
   * The captured call, else the route's logs: only for a route the module
   * captures and the active scope shows (the logs list is scoped).
   */
  const logsLink = computed(() => {
    const id = result.value?.captured?.id
    if (id) return recordLink(id)
    return route.value && routeCaptured.value && route.value.inScope !== false
      ? `${LOGS_PAGE}?${new URLSearchParams({ route: route.value.ref })}`
      : ''
  })
  const errorCopy = computed(() => {
    const value = result.value
    if (!value?.error) return null
    const code = value.abandoned ? 'abandoned' : value.error
    const params = {
      limit: formatBytes(PROXY_RESPONSE_LIMIT, locale.value),
      seconds: PROXY_TIMEOUT_MS / 1000,
      status: value.captured?.status ?? '',
      message: value.message ?? '',
    }
    const description =
      !routeCaptured.value && POINTS_TO_CAPTURED.has(code)
        ? 'description_uncaptured'
        : 'description'
    return {
      title: t(`api.tester.errors.${code}.title`, params),
      description: t(`api.tester.errors.${code}.${description}`, params),
      icon: ERROR_ICONS[value.error] ?? 'i-ph-plugs',
    }
  })
  const liveMessage = computed(() => {
    const value = result.value
    if (sending.value || !value) return ''
    if (errorCopy.value)
      return t('api.tester.live.failed', { title: errorCopy.value.title })
    return t('api.tester.live.sent', {
      status: value.status,
      text: statusText(value.status),
      duration: formatMs(value.durationMs, locale.value),
    })
  })
  const shortcut = computed(() =>
    typeof navigator !== 'undefined' && /Mac|iP/.test(navigator.platform)
      ? '⌘'
      : 'Ctrl',
  )
  return {
    restore,
    clearHistory,
    curl,
    copyCurl,
    editBody,
    formatBody,
    onKey,
    FIELD_SELECTOR,
    live,
    onFocusIn,
    onFocusOut,
    responseBody,
    responseSize,
    recordLink,
    readable,
    logsLink,
    errorCopy,
    liveMessage,
    shortcut,
  }
}
