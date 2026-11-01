import { computed, onMounted, shallowRef, watch } from 'vue'
import { byteLength, formatClock } from '../../../utils/format'
import { errorStatus } from '../../../utils/http'
import {
  type DraftRequest,
  hasConfirmedWrite,
  HISTORY_MAX,
  historyEntry,
  loadDraft,
  loadHistory,
  lostSecrets,
  patchResult,
  rememberConfirmedWrite,
  saveCommonHeaders,
  saveDraft,
  saveHistory,
  secretNames,
  type TesterDraft,
} from '../../../utils/testerHistory'
import {
  type CapturedRequest,
  capturedSummary,
  type KeyValue,
  markedHeaders,
  newRequestId,
  replayFrom,
  sendTesterRequest,
  TesterError,
  type TesterRequest,
  type TesterResult,
} from '../../../utils/testerRequest'
import type {
  CapturedRow,
  ReadJson,
  Row,
  useTesterState,
} from './useTesterState'

/**
 * The tester's flows, as `RouteTester` sets them up after its state: the
 * draft, a replay, sending and what the module captured of a call.
 */
export function useTesterFlow(state: ReturnType<typeof useTesterState>) {
  const consumeRefusal = useReadOnlyRefusal()
  const {
    ON_DEMAND,
    LOGS_API,
    ROUTE_CHANGED,
    CAPTURE_DELAYS_MS,
    CAPTURE_MATCH_MS,
    DRAFT_SAVE_DELAY_MS,
    dateFormat,
    toast,
    currentRoute,
    router,
    sourceTokens,
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
    history,
    tab,
    responseTab,
    sending,
    capturedState,
    capturedLog,
    filledRef,
    method,
    bodyAllowed,
    writes,
    isDelete,
    draftRequest,
    example,
    modified,
    path,
    sentBody,
    auth,
    request,
    blocker,
    redactedCount,
    capturedAvailable,
    shortId,
    t,
    confirm,
    route,
    session,
  } = state
  // --- Draft ---

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
    for (const key of Object.keys(pathValues)) delete pathValues[key]
    for (const name of route.value?.pathParams ?? [])
      pathValues[name] = next.pathValues[name] ?? ''
    useSession.value = next.useSession
  }

  function openFirstTab() {
    tab.value = bodyMode.value !== 'none' ? 'body' : 'headers'
  }

  /**
   * Says which credentials a restored answer was sent with that the fields no
   * longer hold: never stored, or forgotten on reload.
   */
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

  function loadRoute(next: string) {
    flushDraft()
    if (session.inFlight && session.inFlight.ref !== next) {
      session.inFlight.controller.abort(ROUTE_CHANGED)
      session.inFlight = null
      sending.value = false
    }
    session.activeRef = next
    filledRef.value = next
    history.value = loadHistory(next)
    const draft = loadDraft(next)
    if (draft) {
      applyRequest(draft.request)
      origin.value = draft.origin
      replayInfo.value = draft.replay
      showResult(draft.result)
      openFirstTab()
      warnLostSecrets(draft.result?.secrets ?? [])
    } else resetToExample(true)
    const replayId = currentRoute.query.replay
    if (typeof replayId === 'string' && replayId) void replay(replayId, next)
  }

  onMounted(() =>
    watch(
      () => route.value?.ref,
      (next) => {
        if (next) loadRoute(next)
      },
      { immediate: true },
    ),
  )

  // --- Replay ---

  /** Takes `?replay=` off the URL: a replay is loaded once, on its own route. */
  function dropReplayParam() {
    const { replay: _replay, ...rest } = currentRoute.query
    return router.replace({ query: rest })
  }

  const replayedId = shallowRef<string | null>(null)
  const replayRead = useApiData<CapturedRequest>(
    () =>
      replayedId.value
        ? `${LOGS_API}/${encodeURIComponent(replayedId.value)}`
        : null,
    ON_DEMAND,
  )

  async function replay(id: string, ref: string) {
    void dropReplayParam()
    try {
      replayedId.value = id
      await replayRead.execute()
      if (replayRead.error.value) throw replayRead.error.value
      const log = replayRead.data.value
      if (session.activeRef !== ref || !log) return
      const capturedRef = log.route
      if (capturedRef !== ref) {
        toast.add({
          title: t('api.tester.replay_other_route', { route: capturedRef }),
          color: 'warning',
          icon: 'i-ph-warning',
        })
        return
      }
      const replayed = replayFrom(log)
      applyRequest({
        bodyMode: replayed.bodyMode,
        body: replayed.body,
        form: [],
        headers: replayed.headers,
        query: replayed.query,
        pathValues: replayed.pathValues,
        useSession: example.value?.useSession ?? true,
      })
      origin.value = 'replay'
      replayInfo.value = {
        id: log._id,
        at: log.timestamp,
        skippedHeaders: replayed.skippedHeaders,
        bodyMissing: replayed.bodyMissing,
        bodyOmitted: replayed.bodyOmitted,
        bodyTruncated: replayed.bodyTruncated,
      }
      showResult(null)
      openFirstTab()
      toast.add({
        title: t('api.tester.replayed'),
        color: 'info',
        icon: 'i-ph-arrow-counter-clockwise',
      })
    } catch (cause) {
      if (consumeRefusal(cause)) return
      // A request pruned, outside the route scope or matching no route: the
      // logs do not open it.
      const missing = errorStatus(cause) === 404
      toast.add({
        title: t(
          missing ? 'api.tester.replay_not_found' : 'api.tester.replay_failed',
        ),
        color: missing ? 'warning' : 'error',
        icon: 'i-ph-warning',
      })
    }
  }

  const replayTitle = computed(() => {
    const info = replayInfo.value
    if (!info) return ''
    return [
      t('api.tester.replay_banner.title', {
        id: shortId(info.id),
        at: formatClock(info.at, dateFormat.value),
      }),
      ...(info.skippedHeaders.length
        ? [
            t(
              'api.tester.replay_banner.headers',
              { count: info.skippedHeaders.length },
              info.skippedHeaders.length,
            ),
          ]
        : []),
      ...(redactedCount.value
        ? [
            t(
              'api.tester.replay_banner.redacted',
              { count: redactedCount.value },
              redactedCount.value,
            ),
          ]
        : []),
      ...(info.bodyTruncated ? [t('api.tester.replay_banner.truncated')] : []),
    ].join(' · ')
  })
  const replayDescription = computed(() => {
    const info = replayInfo.value
    if (!info) return ''
    return info.skippedHeaders.length
      ? t('api.tester.replay_banner.skipped', {
          names: info.skippedHeaders.join(', '),
        })
      : t('api.tester.replay_banner.credentials')
  })

  // --- Sending ---

  async function confirmSend(ref: string): Promise<boolean> {
    const firstWrite =
      writes.value && !isDelete.value && !hasConfirmedWrite(ref)
    const reasons: string[] = []
    if (isDelete.value)
      reasons.push(t('api.tester.confirm.delete', { path: path.value }))
    else if (firstWrite)
      reasons.push(
        t('api.tester.confirm.write', {
          method: method.value,
          path: path.value,
        }),
      )
    if (redactedCount.value)
      reasons.push(
        t(
          'api.tester.confirm.redacted',
          { count: redactedCount.value },
          redactedCount.value,
        ),
      )
    // A body cut at capture, sent untouched: the API gets part of it.
    const truncated =
      origin.value === 'replay' &&
      !!replayInfo.value?.bodyTruncated &&
      sentBody.value !== undefined
    if (truncated) reasons.push(t('api.tester.confirm.truncated'))
    if (reasons.length === 0) return true
    session.confirming = true
    try {
      const confirmed = await confirm({
        title: isDelete.value
          ? t('api.tester.confirm.delete_title')
          : firstWrite
            ? t('api.tester.confirm.write_title')
            : redactedCount.value
              ? t('api.tester.confirm.redacted_title')
              : t('api.tester.confirm.truncated_title'),
        description: reasons.join(' '),
        color: isDelete.value ? 'error' : 'warning',
        confirmLabel: t('api.tester.send'),
        confirmIcon: 'i-ph-paper-plane-tilt',
        initialFocus: 'cancel',
      })
      if (confirmed && firstWrite) rememberConfirmedWrite(ref)
      return confirmed
    } finally {
      session.confirming = false
    }
  }

  async function send() {
    const value = route.value
    if (sending.value || session.confirming || !value || blocker.value) return
    const ref = value.ref
    if (!(await confirmSend(ref))) return
    if (session.activeRef !== ref || sending.value) return
    // The signed mark that keeps the call out of the statistics: without it,
    // the call would count as the API's own traffic, so it is not sent.
    let source: string
    try {
      source = (await sourceTokens.get()).value
    } catch (cause) {
      if (consumeRefusal(cause)) return
      toast.add({
        title: t('api.tester.source_failed'),
        color: 'error',
        icon: 'i-ph-warning',
      })
      return
    }
    if (session.activeRef !== ref || sending.value) return
    const requestId = newRequestId()
    const sentPath = path.value
    const snapshot = draftRequest.value
    const sentAuth = auth.value
    const outgoing: TesterRequest = {
      ...request.value,
      headers: markedHeaders(request.value.headers, requestId, source),
    }
    const controller = new AbortController()
    session.inFlight = { controller, ref }
    sending.value = true
    const at = Date.now()
    const started = performance.now()
    const sentSecrets = secretNames(outgoing.headers)
    const common = {
      auth: sentAuth,
      ...(sentSecrets.length ? { secrets: sentSecrets } : {}),
      requestId,
      at,
    }
    let outcome: TesterResult
    try {
      const answer = await sendTesterRequest(
        sentPath,
        window.location.origin,
        outgoing,
        controller.signal,
      )
      outcome = {
        ...answer,
        bodySize: byteLength(answer.body),
        durationMs: Math.round(performance.now() - started),
        ...common,
      }
    } catch (cause) {
      if (consumeRefusal(cause)) return
      outcome = {
        status: 0,
        durationMs: Math.round(performance.now() - started),
        headers: {},
        body: '',
        error: cause instanceof TesterError ? cause.code : 'unexpected',
        message: cause instanceof Error ? cause.message : String(cause),
        ...common,
      }
    } finally {
      if (session.inFlight?.controller === controller) {
        session.inFlight = null
        sending.value = false
      }
    }
    // An answer already in hand when the route changed is filed as it came.
    if (controller.signal.reason === ROUTE_CHANGED && outcome.error)
      outcome = { ...outcome, error: 'aborted', abandoned: true }
    commit(ref, value.method, sentPath, snapshot, outcome)
  }

  function cancel() {
    session.inFlight?.controller.abort()
  }

  /**
   * Files a finished call under the route that sent it: its history, and the
   * screen if it still shows that route, else its draft. A call cancelled from
   * the screen stays off the history; one abandoned by a route change is kept,
   * as the API may have received it.
   */
  function commit(
    ref: string,
    sentMethod: string,
    sentPath: string,
    snapshot: DraftRequest,
    outcome: TesterResult,
  ) {
    const shown = !session.unmounted && session.activeRef === ref
    if (outcome.error !== 'aborted' || outcome.abandoned) {
      const entry = historyEntry(sentMethod, sentPath, snapshot, outcome)
      const list = [entry, ...(shown ? history.value : loadHistory(ref))].slice(
        0,
        HISTORY_MAX,
      )
      if (shown) history.value = list
      saveHistory(ref, list)
    }
    if (!shown) {
      const draft = loadDraft(ref)
      saveDraft(ref, {
        ...(draft ?? { request: snapshot, origin: 'example', replay: null }),
        result: outcome,
      })
      return
    }
    showResult(outcome, true)
  }

  // --- What the module captured of the call ---

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  async function findCaptured(
    read: ReadJson,
    target: TesterResult,
  ): Promise<CapturedRequest | null> {
    const id = target.requestId as string
    const page = await read<{ results: CapturedRow[] }>(
      `${LOGS_API}?${new URLSearchParams({ requestId: id })}`,
    )
    // Only the call sent: a list that ignored the filter is no answer.
    const matches = page.results.filter((item) =>
      item.requestId === undefined
        ? page.results.length === 1
        : item.requestId === id,
    )
    const found = matches[0]
    if (
      !found ||
      Date.parse(found.timestamp) < target.at - CAPTURE_MATCH_MS ||
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
    ({ $authFetch, signal }) =>
      findCaptured(
        (url) => $authFetch(url, { signal }),
        capturedTarget.value as TesterResult,
      ),
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

  /**
   * Keeps what the module captured of a call with its answer, on screen, in
   * the draft and in the history: its server time and its record survive a
   * return to the route. A 502 of the proxy for a call the module captured is
   * the API answering more than the proxy returns.
   */
  function keepCaptured(id: string, log: CapturedRequest) {
    const value = result.value
    if (value?.requestId !== id) return
    if (value.captured && value.error !== 'proxy_failed') return
    const patch: Partial<TesterResult> = {
      captured: capturedSummary(log),
      ...(value.error === 'proxy_failed'
        ? { error: 'response_too_large' as const }
        : {}),
    }
    result.value = { ...value, ...patch }
    if (!session.activeRef) return
    history.value = patchResult(history.value, id, patch)
    saveHistory(session.activeRef, history.value)
  }

  /**
   * Shows an answer, on its Captured tab when it failed. What the module
   * captured is looked up for a call just made, for an answer restored before
   * it was found (its server time and record), and when that tab is open.
   */
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
    fill,
    applyRequest,
    openFirstTab,
    warnLostSecrets,
    resetToExample,
    currentDraft,
    flushDraft,
    loadRoute,
    dropReplayParam,
    replayedId,
    replayRead,
    replay,
    replayTitle,
    replayDescription,
    confirmSend,
    send,
    cancel,
    commit,
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
