import { computed } from 'vue'
import { formatClock } from '../../../utils/format'
import type { TesterState } from './useTesterState'

/** How the replay banner words the replayed request: its title and what it left out. */
export function useTesterReplayBanner(state: TesterState) {
  const { dateFormat, replayInfo, redactedCount, shortId, t } = state

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

  return { replayTitle, replayDescription }
}
