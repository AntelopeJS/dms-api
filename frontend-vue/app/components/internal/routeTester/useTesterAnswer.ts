import { computed } from 'vue'
import {
  byteLength,
  formatBytes,
  formatMs,
  prettyBody,
} from '../../../utils/format'
import { statusText } from '../../../utils/http'
import {
  PROXY_RESPONSE_LIMIT,
  PROXY_TIMEOUT_MS,
  revealBidi,
} from '../../../utils/testerRequest'
import type { TesterState } from './useTesterState'

/** The answer the tester shows: its body, its size, its error text and the link to its logs. */
export function useTesterAnswer(state: TesterState) {
  const {
    LOGS_PAGE,
    ERROR_ICONS,
    POINTS_TO_CAPTURED,
    result,
    sending,
    routeCaptured,
    t,
    locale,
    route,
  } = state

  const responseBody = computed(() => prettyBody(result.value?.body))
  const responseSize = computed(() =>
    result.value ? (result.value.bodySize ?? byteLength(result.value.body)) : 0,
  )
  function recordLink(id: string): string {
    return `${LOGS_PAGE}?${new URLSearchParams({ record: id })}`
  }

  function readable(value: string): string {
    try {
      return revealBidi(decodeURI(value))
    } catch {
      return revealBidi(value)
    }
  }

  const logsLink = computed(() => {
    const id = result.value?.captured?.id
    if (id) return recordLink(id)
    return route.value && routeCaptured.value && route.value.inScope !== false
      ? `${LOGS_PAGE}?${new URLSearchParams({ route: route.value.ref })}`
      : ''
  })
  const errorCopy = computed(() => {
    const value = result.value
    if (!value?.error) return null
    const code = value.abandoned ? 'abandoned' : value.error
    const params = {
      limit: formatBytes(PROXY_RESPONSE_LIMIT, locale.value),
      seconds: PROXY_TIMEOUT_MS / 1000,
      status: value.captured?.status ?? '',
      message: value.message ?? '',
    }
    const description =
      !routeCaptured.value && POINTS_TO_CAPTURED.has(code)
        ? 'description_uncaptured'
        : 'description'
    return {
      title: t(`api.tester.errors.${code}.title`, params),
      description: t(`api.tester.errors.${code}.${description}`, params),
      icon: ERROR_ICONS[value.error] ?? 'i-ph-plugs',
    }
  })
  const liveMessage = computed(() => {
    const value = result.value
    if (sending.value || !value) return ''
    if (errorCopy.value)
      return t('api.tester.live.failed', { title: errorCopy.value.title })
    return t('api.tester.live.sent', {
      status: value.status,
      text: statusText(value.status),
      duration: formatMs(value.durationMs, locale.value),
    })
  })
  const shortcut = computed(() =>
    typeof navigator !== 'undefined' && /Mac|iP/.test(navigator.platform)
      ? '⌘'
      : 'Ctrl',
  )

  return {
    responseBody,
    responseSize,
    recordLink,
    readable,
    logsLink,
    errorCopy,
    liveMessage,
    shortcut,
  }
}
