import { byteLength } from '../../../utils/format'
import { secretNames } from '../../../utils/testerHistory'
import {
  markedHeaders,
  newRequestId,
  sendTesterRequest,
  TesterError,
  type TesterRequest,
  type TesterResult,
} from '../../../utils/testerRequest'
import { useTesterCommit } from './useTesterCommit'
import { useTesterConfirm } from './useTesterConfirm'
import type { TesterState } from './useTesterState'

type Common = Pick<TesterResult, 'auth' | 'secrets' | 'requestId' | 'at'>

function failedOutcome(
  cause: unknown,
  started: number,
  common: Common,
): TesterResult {
  return {
    status: 0,
    durationMs: Math.round(performance.now() - started),
    headers: {},
    body: '',
    error: cause instanceof TesterError ? cause.code : 'unexpected',
    message: cause instanceof Error ? cause.message : String(cause),
    ...common,
  }
}

/** Sending a call: the confirmation, the signed source mark, the request itself and its filing. */
export function useTesterSend(
  state: TesterState,
  showResult: (value: TesterResult | null, fresh?: boolean) => void,
  presenter: ReturnType<typeof useApiErrorPresenter>,
) {
  const {
    ROUTE_CHANGED,
    sourceTokens,
    sending,
    draftRequest,
    path,
    auth,
    request,
    blocker,
    route,
    session,
  } = state
  const { confirmSend } = useTesterConfirm(state)
  const { commit } = useTesterCommit(state, showResult)

  async function mintSource(): Promise<string | undefined> {
    try {
      return (await sourceTokens.get()).value
    } catch (cause) {
      presenter.presentError(cause, { fallbackKey: 'api.tester.source_failed' })
      return undefined
    }
  }

  async function perform(
    sentPath: string,
    outgoing: TesterRequest,
    controller: AbortController,
    common: Common,
  ): Promise<TesterResult | null> {
    const started = performance.now()
    try {
      const answer = await sendTesterRequest(
        sentPath,
        window.location.origin,
        outgoing,
        controller.signal,
      )
      return {
        ...answer,
        bodySize: byteLength(answer.body),
        durationMs: Math.round(performance.now() - started),
        ...common,
      }
    } catch (cause) {
      if (cause instanceof TesterError && cause.response) {
        presenter.presentError(cause, {
          fallbackKey: `api.tester.errors.${cause.code}.title`,
        })
        return null
      }
      return failedOutcome(cause, started, common)
    } finally {
      if (session.inFlight?.controller === controller) {
        session.inFlight = null
        sending.value = false
      }
    }
  }

  async function send() {
    const value = route.value
    if (sending.value || session.confirming || !value || blocker.value) return
    const ref = value.ref
    if (!(await confirmSend(ref))) return
    if (session.activeRef !== ref || sending.value) return
    const source = await mintSource()
    if (source === undefined) return
    if (session.activeRef !== ref || sending.value) return
    const requestId = newRequestId()
    const sentPath = path.value
    const snapshot = draftRequest.value
    const outgoing: TesterRequest = {
      ...request.value,
      headers: markedHeaders(request.value.headers, requestId, source),
    }
    const controller = new AbortController()
    session.inFlight = { controller, ref }
    sending.value = true
    const common: Common = { auth: auth.value, requestId, at: Date.now() }
    const sentSecrets = secretNames(outgoing.headers)
    if (sentSecrets.length) common.secrets = sentSecrets
    let outcome = await perform(sentPath, outgoing, controller, common)
    if (!outcome) return
    if (controller.signal.reason === ROUTE_CHANGED && outcome.error)
      outcome = { ...outcome, error: 'aborted', abandoned: true }
    commit(ref, value.method, sentPath, snapshot, outcome)
  }

  function cancel() {
    session.inFlight?.controller.abort()
  }

  return { confirmSend, send, cancel, commit }
}
