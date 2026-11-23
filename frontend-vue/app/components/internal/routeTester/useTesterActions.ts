import {
  HISTORY_MAX,
  type HistoryEntry,
  loadHistory,
  saveHistory,
} from '../../../utils/testerHistory'
import { toCurl } from '../../../utils/snippets'
import type { useTesterFlow } from './useTesterFlow'
import type { TesterState } from './useTesterState'

/** What the user does with the tester: restore or clear its history, copy the cURL, edit the body. */
export function useTesterActions(
  tester: TesterState & ReturnType<typeof useTesterFlow>,
) {
  const {
    toast,
    apiOrigin,
    body,
    query,
    pathValues,
    origin,
    replayInfo,
    history,
    method,
    sentBody,
    effectiveHeaders,
    auth,
    formattedBody,
    t,
    route,
    session,
    applyRequest,
    warnLostSecrets,
    showResult,
  } = tester

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

  function curl(): string {
    const search = new Map<string, string | string[]>()
    for (const { name, value } of query) {
      if (!name) continue
      const known = search.get(name)
      search.set(name, known === undefined ? value : [...[known].flat(), value])
    }
    return toCurl({
      method: method.value,
      path: route.value?.path ?? '/',
      origin: apiOrigin.value,
      pathParams: { ...pathValues },
      query: Object.fromEntries(search),
      headers: effectiveHeaders.value,
      body: sentBody.value,
      session: auth.value === 'session',
    })
  }

  async function copyCurl() {
    const copied = await navigator.clipboard.writeText(curl()).then(
      () => true,
      () => false,
    )
    if (copied) {
      toast.add({
        title: t('api.request.curl_copied'),
        color: 'success',
        icon: 'i-ph-check',
      })
    } else {
      toast.add({ title: t('api.request.copy_failed'), color: 'warning' })
    }
  }

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

  return { restore, clearHistory, curl, copyCurl, editBody, formatBody }
}
