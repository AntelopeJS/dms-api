import { computed } from 'vue'
import {
  acceptsRequestBody,
  isWritingMethod,
  pathSegments,
} from '../../../utils/http'
import { fillPath } from '../../../utils/snippets'
import {
  authModeOf,
  contentTypeFor,
  mergeHeaders,
  revealBidi,
  serializeBody,
  type TesterRequest,
  withQueryRows,
} from '../../../utils/testerRequest'
import type { useTesterFields } from './useTesterFields'
import type { useTesterServices } from './useTesterServices'

/** The request as it leaves: its method, path, headers, body and who it goes as. */
export function useTesterOutgoing(
  services: ReturnType<typeof useTesterServices>,
  fields: ReturnType<typeof useTesterFields>,
) {
  const { loggedIn, route, t } = services
  const { bodyMode, body, form, headers, query, pathValues, useSession } =
    fields
  const { commonHeaders } = fields

  const method = computed(() => route.value?.method ?? 'GET')
  const bodyAllowed = computed(() => acceptsRequestBody(method.value))
  const writes = computed(() => isWritingMethod(method.value))
  const isDelete = computed(() => method.value.toUpperCase() === 'DELETE')

  const segments = computed(() =>
    pathSegments(route.value?.path ?? '/').map((segment) => ({
      ...segment,
      name: segment.text.slice(1),
    })),
  )
  const path = computed(() =>
    withQueryRows(fillPath(route.value?.path ?? '/', pathValues), query),
  )
  const displayQuery = computed(() => {
    const named = query.filter((entry) => entry.name)
    return named.length
      ? revealBidi(
          `?${named.map((entry) => `${entry.name}=${entry.value}`).join('&')}`,
        )
      : ''
  })
  const missingPathParams = computed(() =>
    (route.value?.pathParams ?? []).filter((name) => !pathValues[name]),
  )

  const sentBody = computed(() =>
    bodyAllowed.value
      ? serializeBody(bodyMode.value, body.value, form)
      : undefined,
  )
  const impliedHeaders = computed(() => {
    const implied: Record<string, string> = {}
    const type = contentTypeFor(bodyMode.value)
    if (sentBody.value !== undefined && type) implied['content-type'] = type
    return implied
  })
  const effectiveHeaders = computed(() =>
    mergeHeaders(impliedHeaders.value, commonHeaders, headers),
  )
  const shownImpliedHeaders = computed(() =>
    Object.entries(impliedHeaders.value).filter(
      ([name]) =>
        ![...commonHeaders, ...headers].some(
          (entry) => entry.name.toLowerCase() === name,
        ),
    ),
  )
  const auth = computed(() =>
    authModeOf(effectiveHeaders.value, useSession.value && loggedIn.value),
  )
  const authLabel = computed(() =>
    auth.value === 'manual' &&
    !headers.some((entry) => entry.name.toLowerCase() === 'authorization')
      ? t('api.tester.auth.manual_common')
      : t(`api.tester.auth.${auth.value}`),
  )
  const request = computed<TesterRequest>(() => {
    const outgoing: TesterRequest = {
      method: method.value,
      headers: effectiveHeaders.value,
      useSession: useSession.value && loggedIn.value,
    }
    if (sentBody.value !== undefined) outgoing.body = sentBody.value
    return outgoing
  })

  return {
    method,
    bodyAllowed,
    writes,
    isDelete,
    segments,
    path,
    displayQuery,
    missingPathParams,
    sentBody,
    impliedHeaders,
    effectiveHeaders,
    shownImpliedHeaders,
    auth,
    authLabel,
    request,
  }
}
