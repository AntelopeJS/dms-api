import { computed } from 'vue'
import { formatBytes } from '../../../utils/format'
import {
  type DraftRequest,
  exampleRequest,
  sameRequest,
} from '../../../utils/testerHistory'
import {
  countRedacted,
  formatJson,
  inputProblem,
  jsonProblem,
  markedHeaders,
  PROXY_BODY_LIMIT,
  redactedFields,
  SIZE_PROBE_SOURCE,
} from '../../../utils/testerRequest'
import { TESTER_CONSTANTS } from './testerConstants'
import type { useTesterFields } from './useTesterFields'
import type { useTesterOutgoing } from './useTesterOutgoing'
import type { useTesterServices } from './useTesterServices'

/** What the tester checks of the draft: the example it starts from, why Send is off, what is masked. */
export function useTesterChecks(
  services: ReturnType<typeof useTesterServices>,
  fields: ReturnType<typeof useTesterFields>,
  outgoing: ReturnType<typeof useTesterOutgoing>,
) {
  const { locale, route, t } = services
  const { bodyMode, body, form, headers, query, pathValues, useSession } =
    fields
  const { commonHeaders, history, rows } = fields
  const { bodyAllowed, missingPathParams, path, request } = outgoing

  const draftRequest = computed<DraftRequest>(() => ({
    bodyMode: bodyMode.value,
    body: body.value,
    form: rows(form),
    headers: rows(headers),
    query: rows(query),
    pathValues: { ...pathValues },
    useSession: useSession.value,
  }))

  const example = computed(() =>
    route.value
      ? exampleRequest(
          {
            method: route.value.method,
            pathParams: route.value.pathParams,
            exampleBody: route.value.contract.exampleBody,
            examplePath: route.value.contract.examplePath,
            authStatus: route.value.auth.status,
          },
          history.value,
        )
      : null,
  )
  const modified = computed(
    () => !!example.value && !sameRequest(draftRequest.value, example.value),
  )

  const problem = computed(() =>
    route.value
      ? inputProblem(pathValues, path.value, {
          ...request.value,
          headers: markedHeaders(
            request.value.headers,
            TESTER_CONSTANTS.SIZE_PROBE_ID,
            SIZE_PROBE_SOURCE,
          ),
        })
      : null,
  )
  const blocker = computed<string | null>(() => {
    if (missingPathParams.value.length)
      return t('api.tester.blocked.path_missing', {
        names: missingPathParams.value.map((name) => `:${name}`).join(', '),
      })
    const value = problem.value
    if (!value) return null
    if (value.code === 'path_value')
      return t('api.tester.blocked.path_value', { name: `:${value.name}` })
    if (value.code === 'header')
      return t('api.tester.blocked.header', { name: value.name })
    return t('api.tester.blocked.too_large', {
      size: formatBytes(value.size, locale.value),
      limit: formatBytes(PROXY_BODY_LIMIT, locale.value),
    })
  })

  const jsonWarning = computed(() =>
    bodyAllowed.value && bodyMode.value === 'json'
      ? jsonProblem(body.value)
      : null,
  )
  const formattedBody = computed(() =>
    bodyMode.value === 'json' && body.value.trim() && !jsonWarning.value
      ? formatJson(body.value)
      : null,
  )

  const redactedCount = computed(() => {
    const text =
      bodyAllowed.value && ['json', 'text'].includes(bodyMode.value)
        ? body.value
        : ''
    const fieldRows = bodyMode.value === 'form' ? form : []
    return (
      countRedacted(text) +
      [...headers, ...commonHeaders, ...query, ...fieldRows].reduce(
        (count, entry) => count + countRedacted(entry.value),
        0,
      ) +
      Object.values(pathValues).reduce(
        (count, value) => count + countRedacted(value),
        0,
      )
    )
  })
  const redactedBodyFields = computed(() =>
    ['json', 'text'].includes(bodyMode.value) ? redactedFields(body.value) : [],
  )

  return {
    draftRequest,
    example,
    modified,
    problem,
    blocker,
    jsonWarning,
    formattedBody,
    redactedCount,
    redactedBodyFields,
  }
}
