import {
  hasConfirmedWrite,
  rememberConfirmedWrite,
} from '../../../utils/testerHistory'
import type { TesterState } from './useTesterState'

/** The confirmation a call may ask for before it is sent: a delete, a first write, masked values, a cut body. */
export function useTesterConfirm(state: TesterState) {
  const {
    origin,
    replayInfo,
    method,
    writes,
    isDelete,
    path,
    sentBody,
    redactedCount,
    t,
    confirm,
    session,
  } = state

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
  return { confirmSend }
}
