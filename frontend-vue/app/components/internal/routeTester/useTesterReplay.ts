import { shallowRef } from 'vue'
import { errorStatus } from '../../../utils/http'
import {
  type CapturedRequest,
  replayFrom,
  type TesterResult,
} from '../../../utils/testerRequest'
import type { useTesterDraft } from './useTesterDraft'
import type { TesterState } from './useTesterState'

/** Replaying a captured request into the fields, and how the replay banner words it. */
export function useTesterReplay(
  state: TesterState,
  draft: ReturnType<typeof useTesterDraft>,
  showResult: (value: TesterResult | null) => void,
  presenter: ReturnType<typeof useApiErrorPresenter>,
) {
  const {
    ON_DEMAND,
    LOGS_API,
    toast,
    currentRoute,
    router,
    origin,
    replayInfo,
    example,
    t,
    session,
  } = state
  const { applyRequest, openFirstTab } = draft

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
      presenter.presentError(cause, {
        fallbackKey:
          errorStatus(cause) === 404
            ? 'api.tester.replay_not_found'
            : 'api.tester.replay_failed',
      })
    }
  }

  return {
    dropReplayParam,
    replayedId,
    replayRead,
    replay,
  }
}
