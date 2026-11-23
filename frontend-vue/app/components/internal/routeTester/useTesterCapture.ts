import { computed, shallowRef, watch } from 'vue'
import {
  type CapturedRequest,
  capturedSummary,
  type TesterResult,
} from '../../../utils/testerRequest'
import { patchResult, saveHistory } from '../../../utils/testerHistory'
import type { CapturedRow, ReadJson } from './testerTypes'
import type { TesterState } from './useTesterState'

/**
 * What the module captured of a call, and the answer the tester shows. The
 * capture is kept with the answer, on screen, in the draft and in the history,
 * so its server time and record survive a return to the route; a 502 of the
 * proxy for a call the module captured is the API answering more than the
 * proxy returns. An answer shows on its Captured tab when it failed, and the
 * capture is looked up for a call just made, for an answer restored before it
 * was found, and when that tab is open.
 */
export function useTesterCapture(state: TesterState) {
  const {
    ON_DEMAND,
    LOGS_API,
    CAPTURE_DELAYS_MS,
    CAPTURE_MATCH_MS,
    result,
    history,
    responseTab,
    capturedState,
    capturedLog,
    capturedAvailable,
    session,
  } = state

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  async function findCaptured(
    read: ReadJson,
    requestId: string,
    sentAt: number,
  ): Promise<CapturedRequest | null> {
    const page = await read<{ results: CapturedRow[] }>(
      `${LOGS_API}?${new URLSearchParams({ requestId })}`,
    )
    const matches = page.results.filter((item) =>
      item.requestId === undefined
        ? page.results.length === 1
        : item.requestId === requestId,
    )
    const found = matches[0]
    if (
      !found ||
      Date.parse(found.timestamp) < sentAt - CAPTURE_MATCH_MS ||
      (found.route && session.activeRef && found.route !== session.activeRef)
    )
      return null
    return read<CapturedRequest>(`${LOGS_API}/${encodeURIComponent(found._id)}`)
  }

  const capturedTarget = shallowRef<TesterResult | null>(null)
  const captured = useApiData<CapturedRequest | null>(
    () =>
      capturedTarget.value?.requestId
        ? `dms-api:tester-captured:${capturedTarget.value.requestId}`
        : null,
    async ({ $authFetch, signal }) => {
      const target = capturedTarget.value
      if (!target?.requestId) return null
      return findCaptured(
        (url) => $authFetch(url, { signal }),
        target.requestId,
        target.at,
      )
    },
    ON_DEMAND,
  )

  async function lookUpCaptured(target: TesterResult, retry: boolean) {
    const id = target.requestId
    if (!id) return
    capturedState.value = 'loading'
    const current = () =>
      result.value?.requestId === id && capturedTarget.value?.requestId === id
    for (const delay of retry ? CAPTURE_DELAYS_MS : [0]) {
      if (delay) await wait(delay)
      if (result.value?.requestId !== id) return
      capturedTarget.value = target
      await captured.execute()
      if (!current()) return
      if (captured.error.value) {
        capturedState.value = 'error'
        return
      }
      const log = captured.data.value
      if (log) {
        capturedLog.value = log
        capturedState.value = 'found'
        keepCaptured(id, log)
        return
      }
    }
    capturedState.value = 'missing'
  }

  function keepCaptured(id: string, log: CapturedRequest) {
    const value = result.value
    if (value?.requestId !== id) return
    if (value.captured && value.error !== 'proxy_failed') return
    const patch: Partial<TesterResult> = { captured: capturedSummary(log) }
    if (value.error === 'proxy_failed') patch.error = 'response_too_large'
    result.value = { ...value, ...patch }
    if (!session.activeRef) return
    history.value = patchResult(history.value, id, patch)
    saveHistory(session.activeRef, history.value)
  }

  function showResult(value: TesterResult | null, fresh = false) {
    result.value = value
    capturedState.value = 'idle'
    capturedLog.value = null
    responseTab.value =
      value?.error && capturedAvailable.value ? 'captured' : 'body'
    if (
      value &&
      capturedAvailable.value &&
      (fresh || responseTab.value === 'captured' || !value.captured)
    )
      void lookUpCaptured(value, fresh)
  }

  watch(responseTab, (value) => {
    if (value === 'captured' && capturedState.value === 'idle' && result.value)
      void lookUpCaptured(result.value, false)
  })

  const capturedSlow = computed(() => !!result.value?.captured?.slow)

  return {
    wait,
    findCaptured,
    capturedTarget,
    captured,
    lookUpCaptured,
    keepCaptured,
    showResult,
    capturedSlow,
  }
}
