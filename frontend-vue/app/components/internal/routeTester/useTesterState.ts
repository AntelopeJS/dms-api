import { computed, reactive, ref, useId } from 'vue'
import { formatBytes } from '../../../utils/format'
import {
  acceptsRequestBody,
  isWritingMethod,
  pathSegments,
} from '../../../utils/http'
import { fillPath } from '../../../utils/snippets'
import {
  type BodyOrigin,
  type DraftRequest,
  exampleRequest,
  type HistoryEntry,
  isSecretHeader,
  loadCommonHeaders,
  type ReplayInfo,
  sameRequest,
} from '../../../utils/testerHistory'
import {
  type AuthMode,
  authModeOf,
  type BodyMode,
  type CapturedRequest,
  contentTypeFor,
  countRedacted,
  createSourceTokens,
  formatJson,
  inputProblem,
  jsonProblem,
  type KeyValue,
  markedHeaders,
  mergeHeaders,
  neverSent,
  PROXY_BODY_LIMIT,
  redactedFields,
  revealBidi,
  serializeBody,
  SIZE_PROBE_SOURCE,
  TESTER_SOURCE_URL,
  type TesterErrorCode,
  type TesterRequest,
  type TesterResult,
  type TesterSourceToken,
  withQueryRows,
} from '../../../utils/testerRequest'

export interface Row extends KeyValue {
  id: number
}

/** A row of the logs list, as far as finding a captured call goes. */
export interface CapturedRow {
  _id: string
  route?: string
  timestamp: string
  requestId?: string
}

export type CapturedState = 'idle' | 'loading' | 'found' | 'missing' | 'error'

/** A backend read of the tester's own flows (a replay, a capture lookup). */
export type ReadJson = <R>(url: string) => Promise<R>

/** What the tester keeps outside its reactive state: the route it is on, the call in flight. */
interface TesterSession {
  activeRef: string | null
  inFlight: { controller: AbortController; ref: string } | null
  confirming: boolean
  unmounted: boolean
}

/** The props of `RouteTester`. */
export interface RouteTesterProps {
  fetchUrl: string
  queryKey?: string
}

/**
 * The tester's state, as `RouteTester` sets it up: its constants, its
 * fields and what they compute.
 */
export function useTesterState(props: RouteTesterProps) {
  /**
   * A read the tester runs when it needs it (a replay, a lookup after a call),
   * in the browser only and never again on the page's refreshes.
   */
  const ON_DEMAND = {
    immediate: false,
    server: false,
    watch: false,
    refreshOnPageRefresh: false,
  } as const

  // The tester's own reads of the request logs: by its permission, not the
  // request logs page's.
  const LOGS_API = '/api/monitoring/logs/tester'
  const LOGS_PAGE = '/modules/api/logs'
  /**
   * Abort reason of a call left behind by a route change: filed under its
   * route as abandoned, since the API may have received it.
   */
  const ROUTE_CHANGED = 'route-changed'
  /** The capture is written once the answer is sent: looked for twice. */
  const CAPTURE_DELAYS_MS = [400, 1500]
  /** A captured call older than this is not the one just sent. */
  const CAPTURE_MATCH_MS = 60_000
  /** An id as long as a real one, to size the request before sending it. */
  const SIZE_PROBE_ID = '00000000-0000-0000-0000-000000000000'
  const DRAFT_SAVE_DELAY_MS = 250
  const BODY_MODES: BodyMode[] = ['json', 'text', 'form', 'none']
  const AUTH_ICONS: Record<AuthMode, string> = {
    session: 'i-ph-user-check',
    manual: 'i-ph-key',
    none: 'i-ph-lock-simple-open',
  }
  const ERROR_ICONS: Partial<Record<TesterErrorCode, string>> = {
    invalid_input: 'i-ph-prohibit',
    body_too_large: 'i-ph-file-x',
    not_authenticated: 'i-ph-sign-in',
    not_owner: 'i-ph-lock-simple',
    cross_origin: 'i-ph-shield-warning',
    response_too_large: 'i-ph-file-x',
    timeout: 'i-ph-timer',
    aborted: 'i-ph-x-circle',
  }
  /**
   * Error texts that send to the Captured tab: another text on a route the
   * module does not capture.
   */
  const POINTS_TO_CAPTURED: ReadonlySet<string> = new Set([
    'proxy_failed',
    'timeout',
    'aborted',
    'abandoned',
  ])

  const { t } = useI18n()
  const { formatLocale: locale } = useRegionalFormat({ locale: 'format' })
  const dateFormat = useDateFormat()
  const toast = useToast()
  const { confirm } = useConfirm()
  const { loggedIn } = useDmsUserSession()
  const currentRoute = useDmsRoute()
  const router = useDmsRouter()
  const { $authFetch } = useAuthFetch()
  const {
    data: route,
    pending,
    selection,
  } = useRouteDetail(props.fetchUrl, props.queryKey)
  const apiOrigin = useApiOrigin(() => route.value?.apiOrigin)
  const blockerId = useId()
  // Not a `useApiData` read: each call mints a short-lived token, which must
  // never be shared between calls, cached or handed over with the page.
  const sourceTokens = createSourceTokens(() =>
    $authFetch<TesterSourceToken>(TESTER_SOURCE_URL),
  )
  const bodyHintId = useId()

  let nextRowId = 0
  const row = (name = '', value = ''): Row => ({ id: nextRowId++, name, value })
  const rows = (list: Row[]): KeyValue[] =>
    list.map(({ name, value }) => ({ name, value }))

  const bodyMode = ref<BodyMode>('none')
  const body = ref('')
  const form = reactive<Row[]>([])
  const headers = reactive<Row[]>([])
  const query = reactive<Row[]>([])
  const pathValues = reactive<Record<string, string>>({})
  const useSession = ref(true)
  const origin = ref<BodyOrigin>('example')
  const replayInfo = ref<ReplayInfo | null>(null)
  const result = ref<TesterResult | null>(null)
  const commonHeaders = reactive<Row[]>(
    loadCommonHeaders().map((entry) => row(entry.name, entry.value)),
  )
  const history = ref<HistoryEntry[]>([])
  const tab = ref('body')
  const responseTab = ref('body')
  const sending = ref(false)
  const capturedState = ref<CapturedState>('idle')
  const capturedLog = ref<CapturedRequest | null>(null)

  // The route the fields belong to, the call in flight and its route.
  const session: TesterSession = {
    activeRef: null,
    inFlight: null,
    confirming: false,
    unmounted: false,
  }
  // The route the fields were filled for: they come from this browser's drafts,
  // history and headers, so the tester shows once mounted, never on a server.
  const filledRef = ref<string | null>(null)

  const method = computed(() => route.value?.method ?? 'GET')
  const bodyAllowed = computed(() => acceptsRequestBody(method.value))
  const writes = computed(() => isWritingMethod(method.value))
  const isDelete = computed(() => method.value.toUpperCase() === 'DELETE')

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

  // --- The request as it leaves ---

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
  /** Headers as the API gets them, before the session and the tester's marks. */
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
  /** Who the call goes as; an Authorization of the headers for all routes says so. */
  const authLabel = computed(() =>
    auth.value === 'manual' &&
    !headers.some((entry) => entry.name.toLowerCase() === 'authorization')
      ? t('api.tester.auth.manual_common')
      : t(`api.tester.auth.${auth.value}`),
  )
  const request = computed<TesterRequest>(() => ({
    method: method.value,
    headers: effectiveHeaders.value,
    useSession: useSession.value && loggedIn.value,
    ...(sentBody.value !== undefined ? { body: sentBody.value } : {}),
  }))

  const problem = computed(() =>
    route.value
      ? inputProblem(pathValues, path.value, {
          ...request.value,
          headers: markedHeaders(
            request.value.headers,
            SIZE_PROBE_ID,
            SIZE_PROBE_SOURCE,
          ),
        })
      : null,
  )
  /** Why Send is off, said next to it. */
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

  /** Masked values ([REDACTED]) still in what would be sent. */
  const redactedCount = computed(() => {
    const text =
      bodyAllowed.value && ['json', 'text'].includes(bodyMode.value)
        ? body.value
        : ''
    const fields = bodyMode.value === 'form' ? form : []
    return (
      countRedacted(text) +
      [...headers, ...commonHeaders, ...query, ...fields].reduce(
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

  // --- Tabs ---

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
    BODY_MODES.map((value) => ({
      label: t(`api.tester.body_modes.${value}`),
      value,
    })),
  )

  /** Credentials typed among the headers for all routes: every route gets them. */
  const commonSecrets = computed(() =>
    commonHeaders
      .filter((entry) => entry.value && isSecretHeader(entry.name))
      .map((entry) => entry.name),
  )

  /** The key / value lists the open tab edits. */
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

  /** False for a route the module leaves out of its logs (the console's own). */
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

  // --- What the line under the body says ---

  const bodyHint = computed<{ text: string; tone: 'dimmed' | 'warning' }>(
    () => {
      const contract = route.value?.contract
      if (bodyMode.value === 'none')
        return { text: t('api.tester.body_hint.none'), tone: 'dimmed' }
      if (origin.value === 'replay' && replayInfo.value) {
        const info = replayInfo.value
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
            text:
              problem.value?.code === 'body_too_large'
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
    },
  )

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

  function shortId(id: string): string {
    return id.slice(0, 8)
  }

  return {
    ON_DEMAND,
    LOGS_API,
    LOGS_PAGE,
    ROUTE_CHANGED,
    CAPTURE_DELAYS_MS,
    CAPTURE_MATCH_MS,
    SIZE_PROBE_ID,
    DRAFT_SAVE_DELAY_MS,
    BODY_MODES,
    AUTH_ICONS,
    ERROR_ICONS,
    POINTS_TO_CAPTURED,
    dateFormat,
    toast,
    currentRoute,
    router,
    apiOrigin,
    blockerId,
    sourceTokens,
    bodyHintId,
    row,
    rows,
    bodyMode,
    body,
    form,
    headers,
    query,
    pathValues,
    useSession,
    origin,
    replayInfo,
    result,
    commonHeaders,
    history,
    tab,
    responseTab,
    sending,
    capturedState,
    capturedLog,
    filledRef,
    method,
    bodyAllowed,
    writes,
    isDelete,
    draftRequest,
    example,
    modified,
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
    problem,
    blocker,
    jsonWarning,
    formattedBody,
    redactedCount,
    redactedBodyFields,
    tabs,
    bodyModeItems,
    commonSecrets,
    editors,
    routeCaptured,
    capturedAvailable,
    responseTabs,
    bodyHint,
    queryHint,
    shortId,
    t,
    locale,
    confirm,
    loggedIn,
    $authFetch,
    route,
    pending,
    selection,
    session,
  }
}
