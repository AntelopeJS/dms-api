import { computed } from 'vue'
import { isSecretHeader } from '../../../utils/testerHistory'
import { neverSent } from '../../../utils/testerRequest'
import { TESTER_CONSTANTS } from './testerConstants'
import type { useTesterFields } from './useTesterFields'
import type { useTesterOutgoing } from './useTesterOutgoing'
import type { useTesterServices } from './useTesterServices'

/** What the tester lists on screen: the tabs of the request and of the answer, and the key / value editors. */
export function useTesterView(
  services: ReturnType<typeof useTesterServices>,
  fields: ReturnType<typeof useTesterFields>,
  outgoing: ReturnType<typeof useTesterOutgoing>,
) {
  const { route, t } = services
  const { headers, query, form, commonHeaders, tab, result } = fields
  const { bodyAllowed } = outgoing

  const tabs = computed(() => [
    ...(bodyAllowed.value
      ? [{ label: t('api.tester.tabs.body'), value: 'body' }]
      : []),
    {
      label: t('api.tester.tabs.headers'),
      value: 'headers',
      badge:
        [...headers, ...commonHeaders].filter((entry) => entry.name).length ||
        undefined,
    },
    {
      label: t('api.tester.tabs.query'),
      value: 'query',
      badge: query.filter((entry) => entry.name).length || undefined,
    },
  ])

  const bodyModeItems = computed(() =>
    TESTER_CONSTANTS.BODY_MODES.map((value) => ({
      label: t(`api.tester.body_modes.${value}`),
      value,
    })),
  )

  const commonSecrets = computed(() =>
    commonHeaders
      .filter((entry) => entry.value && isSecretHeader(entry.name))
      .map((entry) => entry.name),
  )

  const editors = computed(() => {
    if (tab.value === 'headers')
      return [
        { key: 'headers', list: headers, add: t('api.tester.add_header') },
        {
          key: 'common',
          list: commonHeaders,
          add: t('api.tester.add_header'),
          title: t('api.tester.common_headers'),
          hint: t('api.tester.common_headers_hint'),
          warning: commonSecrets.value.length
            ? t('api.tester.common_secret', {
                names: commonSecrets.value.join(', '),
              })
            : undefined,
        },
      ]
    if (tab.value === 'query')
      return [{ key: 'query', list: query, add: t('api.tester.add_query') }]
    return [{ key: 'form', list: form, add: t('api.tester.add_field') }]
  })

  const routeCaptured = computed(() => route.value?.captured !== false)
  const capturedAvailable = computed(
    () =>
      routeCaptured.value &&
      !!result.value?.requestId &&
      !neverSent(result.value.error),
  )
  const responseTabs = computed(() => [
    ...(result.value?.error
      ? []
      : [
          { label: t('api.tester.response'), value: 'body' },
          {
            label: t('api.tester.tabs.headers'),
            value: 'headers',
            badge: Object.keys(result.value?.headers ?? {}).length || undefined,
          },
        ]),
    ...(capturedAvailable.value
      ? [{ label: t('api.tester.tabs.captured'), value: 'captured' }]
      : []),
  ])

  return {
    tabs,
    bodyModeItems,
    commonSecrets,
    editors,
    routeCaptured,
    capturedAvailable,
    responseTabs,
  }
}
