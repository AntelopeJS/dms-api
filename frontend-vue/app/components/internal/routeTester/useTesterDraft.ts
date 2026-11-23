import { watch } from 'vue'
import {
  type DraftRequest,
  lostSecrets,
  saveCommonHeaders,
  saveDraft,
  type TesterDraft,
} from '../../../utils/testerHistory'
import type { KeyValue, TesterResult } from '../../../utils/testerRequest'
import type { Row } from './testerTypes'
import type { TesterState } from './useTesterState'

/**
 * The tester's draft: filling the fields, resetting them to the example and
 * saving them per route. A restored answer warns of the credentials it was sent
 * with that the fields no longer hold: never stored, or forgotten on reload.
 */
export function useTesterDraft(
  state: TesterState,
  showResult: (value: TesterResult | null) => void,
) {
  const {
    DRAFT_SAVE_DELAY_MS,
    toast,
    row,
    rows,
    bodyMode,
    body,
    form,
    headers,
    query,
    pathValues,
    useSession,
    origin,
    replayInfo,
    result,
    commonHeaders,
    tab,
    bodyAllowed,
    draftRequest,
    example,
    modified,
    t,
    route,
    session,
  } = state

  function fill(list: Row[], values: KeyValue[]) {
    list.splice(
      0,
      list.length,
      ...values.map((entry) => row(entry.name, entry.value)),
    )
  }

  function applyRequest(next: DraftRequest) {
    bodyMode.value = bodyAllowed.value ? next.bodyMode : 'none'
    body.value = next.body
    fill(form, next.form)
    fill(headers, next.headers)
    fill(query, next.query)
    for (const key of Object.keys(pathValues))
      Reflect.deleteProperty(pathValues, key)
    for (const name of route.value?.pathParams ?? [])
      pathValues[name] = next.pathValues[name] ?? ''
    useSession.value = next.useSession
  }

  function openFirstTab() {
    tab.value = bodyMode.value !== 'none' ? 'body' : 'headers'
  }

  function warnLostSecrets(sent: string[]) {
    const lost = lostSecrets(sent, [...headers, ...commonHeaders])
    if (lost.length)
      toast.add({
        title: t('api.tester.secrets_not_kept', { names: lost.join(', ') }),
        color: 'warning',
        icon: 'i-ph-key',
      })
  }

  function resetToExample(clearResult = false) {
    if (!example.value) return
    applyRequest(example.value)
    origin.value = 'example'
    replayInfo.value = null
    if (clearResult) showResult(null)
    openFirstTab()
  }

  function currentDraft(): TesterDraft | null {
    if (!modified.value && !result.value && !replayInfo.value) return null
    return {
      request: draftRequest.value,
      origin: origin.value,
      replay: replayInfo.value,
      result: result.value,
    }
  }

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let saveRef: string | null = null

  function flushDraft() {
    if (saveTimer === undefined || !saveRef) return
    clearTimeout(saveTimer)
    saveTimer = undefined
    saveDraft(saveRef, currentDraft())
  }

  watch([draftRequest, origin, replayInfo, result], () => {
    if (!session.activeRef) return
    if (saveTimer !== undefined) clearTimeout(saveTimer)
    saveRef = session.activeRef
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      if (session.activeRef && saveRef === session.activeRef)
        saveDraft(session.activeRef, currentDraft())
    }, DRAFT_SAVE_DELAY_MS)
  })

  watch(commonHeaders, () => saveCommonHeaders(rows(commonHeaders)), {
    deep: true,
  })

  return {
    fill,
    applyRequest,
    openFirstTab,
    warnLostSecrets,
    resetToExample,
    currentDraft,
    flushDraft,
  }
}
