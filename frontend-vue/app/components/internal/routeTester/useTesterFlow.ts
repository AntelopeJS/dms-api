import { onMounted, watch } from 'vue'
import { loadDraft, loadHistory } from '../../../utils/testerHistory'
import { useTesterCapture } from './useTesterCapture'
import { useTesterDraft } from './useTesterDraft'
import { useTesterReplay } from './useTesterReplay'
import { useTesterReplayBanner } from './useTesterReplayBanner'
import { useTesterSend } from './useTesterSend'
import type { TesterState } from './useTesterState'
import { isString } from '../../../utils/guards'

/**
 * The tester's flows, as `RouteTester` sets them up after its state: the
 * draft, a replay, sending and what the module captured of a call.
 */
export function useTesterFlow(state: TesterState) {
  const presenter = useApiErrorPresenter()
  const {
    ROUTE_CHANGED,
    currentRoute,
    origin,
    replayInfo,
    history,
    sending,
    filledRef,
    route,
    session,
  } = state
  const capture = useTesterCapture(state)
  const { showResult } = capture
  const draft = useTesterDraft(state, showResult)
  const replay = useTesterReplay(state, draft, showResult, presenter)
  const banner = useTesterReplayBanner(state)
  const send = useTesterSend(state, showResult, presenter)
  const { applyRequest, openFirstTab, resetToExample, warnLostSecrets } = draft

  function loadRoute(next: string) {
    draft.flushDraft()
    if (session.inFlight && session.inFlight.ref !== next) {
      session.inFlight.controller.abort(ROUTE_CHANGED)
      session.inFlight = null
      sending.value = false
    }
    session.activeRef = next
    filledRef.value = next
    history.value = loadHistory(next)
    const saved = loadDraft(next)
    if (saved) {
      applyRequest(saved.request)
      origin.value = saved.origin
      replayInfo.value = saved.replay
      showResult(saved.result)
      openFirstTab()
      warnLostSecrets(saved.result?.secrets ?? [])
    } else resetToExample(true)
    const replayId = currentRoute.query.replay
    if (isString(replayId) && replayId) void replay.replay(replayId, next)
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

  return { ...draft, loadRoute, ...replay, ...banner, ...send, ...capture }
}
