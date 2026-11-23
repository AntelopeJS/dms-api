import {
  type DraftRequest,
  HISTORY_MAX,
  historyEntry,
  loadDraft,
  loadHistory,
  saveDraft,
  saveHistory,
} from '../../../utils/testerHistory'
import type { TesterResult } from '../../../utils/testerRequest'
import type { TesterState } from './useTesterState'

/**
 * Files a finished call under the route that sent it: its history, and the
 * screen if it still shows that route, else its draft. A call cancelled from
 * the screen stays off the history; one abandoned by a route change is kept,
 * as the API may have received it.
 */
export function useTesterCommit(
  state: TesterState,
  showResult: (value: TesterResult | null, fresh?: boolean) => void,
) {
  const { history, session } = state

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
  return { commit }
}
