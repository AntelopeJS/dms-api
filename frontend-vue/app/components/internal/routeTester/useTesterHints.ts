import { computed } from 'vue'
import { formatBytes } from '../../../utils/format'
import type { ReplayInfo } from '../../../utils/testerHistory'
import { PROXY_BODY_LIMIT } from '../../../utils/testerRequest'
import type { useTesterChecks } from './useTesterChecks'
import type { useTesterFields } from './useTesterFields'
import type { useTesterOutgoing } from './useTesterOutgoing'
import type { useTesterServices } from './useTesterServices'

type Services = ReturnType<typeof useTesterServices>
type Hint = { text: string; tone: 'dimmed' | 'warning' }

/** The first eight characters of a request id, as the tester names it. */
export function shortId(id: string): string {
  return id.slice(0, 8)
}

function replayHint(
  info: ReplayInfo,
  tooLarge: boolean,
  { t, locale }: Pick<Services, 't' | 'locale'>,
): Hint {
  if (info.bodyMissing)
    return {
      text: info.bodyOmitted
        ? t('api.tester.body_hint.replay_missing', {
            reason: t(`api.tester.body_omitted.${info.bodyOmitted}`),
          })
        : t('api.tester.body_hint.replay_missing_unknown'),
      tone: 'warning',
    }
  if (info.bodyTruncated)
    return {
      text: tooLarge
        ? t('api.tester.body_hint.replay_truncated_too_large', {
            limit: formatBytes(PROXY_BODY_LIMIT, locale.value),
          })
        : t('api.tester.body_hint.replay_truncated'),
      tone: 'warning',
    }
  return {
    text: t('api.tester.body_hint.replay', { id: shortId(info.id) }),
    tone: 'dimmed',
  }
}

/** The lines under the body and the query, which say where the fields come from. */
export function useTesterHints(
  services: Services,
  fields: ReturnType<typeof useTesterFields>,
  outgoing: ReturnType<typeof useTesterOutgoing>,
  checks: ReturnType<typeof useTesterChecks>,
) {
  const { route, t } = services
  const { bodyMode, origin, replayInfo } = fields
  const { sentBody } = outgoing
  const { problem } = checks

  const bodyHint = computed<Hint>(() => {
    const contract = route.value?.contract
    if (bodyMode.value === 'none')
      return { text: t('api.tester.body_hint.none'), tone: 'dimmed' }
    if (origin.value === 'replay' && replayInfo.value)
      return replayHint(
        replayInfo.value,
        problem.value?.code === 'body_too_large',
        services,
      )
    if (sentBody.value === undefined)
      return { text: t('api.tester.body_hint.empty'), tone: 'dimmed' }
    if (bodyMode.value === 'form')
      return { text: t('api.tester.body_hint.form'), tone: 'dimmed' }
    if (origin.value === 'history')
      return { text: t('api.tester.body_hint.history'), tone: 'dimmed' }
    if (origin.value === 'edited' || !contract)
      return { text: '', tone: 'dimmed' }
    if (contract.exampleBody !== null && contract.exampleBody !== undefined)
      return { text: t('api.tester.body_hint.example'), tone: 'dimmed' }
    const span = { days: contract.windowDays, count: contract.total }
    if (contract.total === 0)
      return {
        text: t('api.tester.body_hint.no_capture', span),
        tone: 'dimmed',
      }
    return {
      text: contract.sampled
        ? t(
            'api.tester.body_hint.no_json',
            { ...span, count: contract.sampled },
            contract.sampled,
          )
        : t('api.tester.body_hint.no_success', span, contract.total),
      tone: 'dimmed',
    }
  })

  const queryHint = computed(() => {
    const contract = route.value?.contract
    if (!contract) return ''
    if (contract.queryParams.length)
      return t('api.tester.query_known', {
        names: contract.queryParams.join(', '),
      })
    const span = { days: contract.windowDays }
    return contract.total
      ? t('api.tester.query_none', span)
      : t('api.tester.query_no_capture', span)
  })

  return { bodyHint, queryHint, shortId }
}
