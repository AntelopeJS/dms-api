<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  byteLength,
  formatBytes,
  formatClock,
  formatMs,
  prettyBody,
} from '../../utils/format'
import { hasRequestBody, isWritingMethod, statusText } from '../../utils/http'
import { fillPath, toCurl, withQuery } from '../../utils/snippets'
import {
  sendTesterRequest,
  type TesterRequest,
} from '../../utils/testerRequest'
import {
  type HistoryEntry,
  HISTORY_MAX,
  loadHistory,
  saveHistory,
} from '../../utils/testerHistory'
import ApiCode from '../internal/ApiCode.vue'
import ApiKeyValues from '../internal/ApiKeyValues.vue'
import ApiMethodBadge from '../internal/ApiMethodBadge.vue'
import ApiStatusBadge from '../internal/ApiStatusBadge.vue'

// Call the selected route from the dashboard: the body starts from the last
// request it accepted, a call that writes data says so before it leaves, and
// the answer shows its status, time and size, next to the request it became
// in the logs. `?replay=<request id>` loads a captured request instead.
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{ fetchUrl: string; queryKey?: string }>(),
  {
    queryKey: 'route',
  },
)

interface Row {
  id: number
  name: string
  value: string
}

interface TesterResult {
  status: number
  durationMs: number
  headers: Record<string, string>
  body: string
  error?: 'network' | 'request'
  message?: string
  sentWithSession: boolean
}

interface CapturedRequest {
  method: string
  uri: string
  pathParams?: Record<string, string>
  query?: Record<string, string | string[]>
  requestHeaders?: Record<string, string>
  requestBody?: string
}

const LOGS_API = '/api/monitoring/logs'
const SKIPPED_REPLAY_HEADERS = new Set([
  'host',
  'content-length',
  'user-agent',
  'accept-encoding',
  'origin',
  'referer',
])

const { t } = useI18n()
const apiOrigin = useApiOrigin()
const locale = useFormatLocale()
const toast = useToast()
const { loggedIn } = useUserSession()
const currentRoute = useDmsRoute()
const { $authFetch } = useAuthFetch()
const {
  data: route,
  pending,
  selection,
} = useRouteDetail(props.fetchUrl, props.queryKey)

let nextRowId = 0
const row = (name = '', value = ''): Row => ({ id: nextRowId++, name, value })

const body = ref('')
const headers = reactive<Row[]>([])
const query = reactive<Row[]>([])
const pathValues = reactive<Record<string, string>>({})
const useSession = ref(true)
const sending = ref(false)
const result = ref<TesterResult | null>(null)
const history = ref<HistoryEntry[]>([])
const tab = ref('body')
const responseTab = ref('body')

const method = computed(() => route.value?.method ?? 'GET')
const withBody = computed(() => hasRequestBody(method.value))
const writes = computed(() => isWritingMethod(method.value))

const exampleBody = computed(() => {
  const example = route.value?.contract.exampleBody
  return example ? JSON.stringify(example, null, 2) : '{}'
})

const path = computed(() =>
  withQuery(
    fillPath(route.value?.path ?? '/', pathValues),
    Object.fromEntries(
      query
        .filter((entry) => entry.name)
        .map((entry) => [entry.name, entry.value]),
    ),
  ),
)
const missingPathParams = computed(() =>
  (route.value?.pathParams ?? []).filter((name) => !pathValues[name]),
)

const bodyError = computed(() => {
  if (!withBody.value || !body.value.trim()) return null
  try {
    JSON.parse(body.value)
    return null
  } catch (cause) {
    return (cause as Error).message
  }
})

const tabs = computed(() => [
  ...(withBody.value
    ? [{ label: t('api.tester.tabs.body'), value: 'body' }]
    : []),
  {
    label: t('api.tester.tabs.headers'),
    value: 'headers',
    badge: headers.filter((entry) => entry.name).length || undefined,
  },
  {
    label: t('api.tester.tabs.query'),
    value: 'query',
    badge: query.filter((entry) => entry.name).length || undefined,
  },
  {
    label: t('api.tester.tabs.path'),
    value: 'path',
    badge: route.value?.pathParams.length || undefined,
  },
])

const responseTabs = computed(() => [
  { label: t('api.tester.response'), value: 'body' },
  {
    label: t('api.tester.tabs.headers'),
    value: 'headers',
    badge: Object.keys(result.value?.headers ?? {}).length || undefined,
  },
])

function headerRecord(): Record<string, string> {
  return Object.fromEntries(
    headers
      .filter((entry) => entry.name)
      .map((entry) => [entry.name, entry.value]),
  )
}

function reset() {
  const value = route.value
  if (!value) return
  body.value = withBody.value ? exampleBody.value : ''
  headers.splice(0, headers.length)
  if (withBody.value) headers.push(row('content-type', 'application/json'))
  query.splice(0, query.length)
  for (const key of Object.keys(pathValues)) delete pathValues[key]
  for (const name of value.pathParams) pathValues[name] = ''
  result.value = null
  tab.value = withBody.value ? 'body' : 'headers'
}

function curl(): string {
  return toCurl({
    method: method.value,
    url: `${apiOrigin.value}${path.value}`,
    headers: {
      ...(useSession.value ? { authorization: 'Bearer $TOKEN' } : {}),
      ...headerRecord(),
    },
    body: withBody.value && body.value.trim() ? body.value : undefined,
  })
}

async function copyCurl() {
  try {
    await navigator.clipboard.writeText(curl())
    toast.add({
      title: t('api.request.curl_copied'),
      color: 'success',
      icon: 'i-ph-check',
    })
  } catch {
    toast.add({
      title: t('api.request.copy_failed'),
      color: 'error',
      icon: 'i-ph-warning',
    })
  }
}

function remember(entry: TesterResult) {
  const value = route.value
  if (!value) return
  history.value = [
    {
      at: Date.now(),
      path: path.value,
      headers: headerRecord(),
      query: Object.fromEntries(
        query
          .filter((item) => item.name)
          .map((item) => [item.name, item.value]),
      ),
      pathValues: { ...pathValues },
      body: withBody.value ? body.value : undefined,
      useSession: useSession.value,
      result: entry,
    },
    ...history.value,
  ].slice(0, HISTORY_MAX)
  saveHistory(value.ref, history.value)
}

async function send() {
  if (
    sending.value ||
    !route.value ||
    bodyError.value ||
    missingPathParams.value.length
  )
    return
  sending.value = true
  const request: TesterRequest = {
    method: method.value,
    headers: headerRecord(),
    useSession: useSession.value && loggedIn.value,
  }
  if (withBody.value && body.value.trim()) request.body = body.value
  const started = performance.now()
  try {
    const answer = await sendTesterRequest(
      path.value,
      window.location.origin,
      request,
    )
    result.value = {
      ...answer,
      durationMs: Math.round(performance.now() - started),
      sentWithSession: request.useSession,
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    result.value = {
      status: 0,
      durationMs: Math.round(performance.now() - started),
      headers: {},
      body: '',
      error: /\(\d+\)/.test(message) ? 'request' : 'network',
      message,
      sentWithSession: request.useSession,
    }
  } finally {
    sending.value = false
  }
  responseTab.value = 'body'
  remember(result.value)
}

function restore(entry: HistoryEntry) {
  headers.splice(
    0,
    headers.length,
    ...Object.entries(entry.headers).map(([name, value]) => row(name, value)),
  )
  query.splice(
    0,
    query.length,
    ...Object.entries(entry.query).map(([name, value]) => row(name, value)),
  )
  Object.assign(pathValues, entry.pathValues)
  if (entry.body !== undefined) body.value = entry.body
  useSession.value = entry.useSession
  result.value = entry.result
}

function clearHistory() {
  history.value = []
  if (route.value) saveHistory(route.value.ref, [])
}

async function replay(id: string) {
  try {
    const captured = await $authFetch<CapturedRequest>(
      `${LOGS_API}/${encodeURIComponent(id)}`,
    )
    headers.splice(
      0,
      headers.length,
      ...Object.entries(captured.requestHeaders ?? {})
        .filter(([name]) => !SKIPPED_REPLAY_HEADERS.has(name))
        .map(([name, value]) => row(name, value)),
    )
    query.splice(
      0,
      query.length,
      ...Object.entries(captured.query ?? {}).map(([name, value]) =>
        row(name, Array.isArray(value) ? (value[0] ?? '') : value),
      ),
    )
    Object.assign(pathValues, captured.pathParams ?? {})
    if (captured.requestBody) body.value = prettyBody(captured.requestBody).text
    toast.add({
      title: t('api.tester.replayed'),
      color: 'info',
      icon: 'i-ph-arrow-counter-clockwise',
    })
  } catch {
    toast.add({
      title: t('api.tester.replay_failed'),
      color: 'error',
      icon: 'i-ph-warning',
    })
  }
}

watch(
  () => route.value?.ref,
  (ref) => {
    if (!ref) return
    reset()
    history.value = loadHistory(ref)
    const replayId = currentRoute.query.replay
    if (typeof replayId === 'string' && replayId) void replay(replayId)
  },
  { immediate: true },
)

function onKey(event: KeyboardEvent) {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    void send()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const responseBody = computed(() => prettyBody(result.value?.body))
const logsLink = computed(() =>
  route.value
    ? `/modules/api/logs?${new URLSearchParams({ route: route.value.ref })}`
    : '',
)
const shortcut = computed(() =>
  typeof navigator !== 'undefined' && /Mac|iP/.test(navigator.platform)
    ? '⌘'
    : 'Ctrl',
)
</script>

<template>
  <div v-if="!selection.ref.value" />
  <USkeleton v-else-if="pending" class="h-72" />
  <div v-else-if="route" class="flex flex-col gap-4">
    <DmsCard :padded="false">
      <div class="flex flex-wrap items-center gap-3 px-4 py-3">
        <ApiMethodBadge :method="route.method" solid />
        <code
          class="text-highlighted min-w-0 grow truncate font-mono text-[13px]"
        >
          {{ path }}
        </code>
        <UButton
          size="sm"
          color="neutral"
          variant="outline"
          icon="i-ph-terminal"
          :label="t('api.request.copy_curl')"
          @click="copyCurl"
        />
        <UButton
          size="sm"
          icon="i-ph-paper-plane-tilt"
          :loading="sending"
          :disabled="!!bodyError || missingPathParams.length > 0"
          :label="t('api.tester.send')"
          @click="send"
        >
          <template #trailing>
            <UKbd :value="shortcut" size="sm" />
            <UKbd value="↵" size="sm" />
          </template>
        </UButton>
      </div>
      <div
        class="border-default flex flex-wrap items-center gap-3 border-t px-4 py-2.5 text-[12.5px]"
      >
        <label class="flex cursor-pointer items-center gap-2">
          <USwitch v-model="useSession" size="sm" :disabled="!loggedIn" />
          <span class="text-default">{{ t('api.tester.session') }}</span>
        </label>
        <span class="text-dimmed">{{ t('api.tester.session_hint') }}</span>
        <span class="grow" />
        <DmsStatusPill
          v-if="writes"
          tone="warning"
          icon="i-ph-warning"
          :mono="false"
          :label="t('api.tester.writes')"
        />
      </div>
    </DmsCard>

    <div class="grid gap-4 2xl:grid-cols-2">
      <DmsCard :padded="false">
        <div class="border-default flex items-center gap-2 border-b px-3">
          <UTabs
            v-model="tab"
            :items="tabs"
            :content="false"
            variant="link"
            size="sm"
            class="grow"
          />
          <UButton
            v-if="withBody && tab === 'body'"
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-ph-arrow-counter-clockwise"
            :label="t('api.tester.reset')"
            @click="body = exampleBody"
          />
        </div>
        <div class="p-3">
          <template v-if="tab === 'body'">
            <UTextarea
              v-model="body"
              :rows="12"
              autoresize
              :maxrows="24"
              class="w-full font-mono text-[12.5px]"
              :color="bodyError ? 'error' : undefined"
              :aria-invalid="!!bodyError"
              spellcheck="false"
            />
            <p v-if="bodyError" class="text-error mt-1.5 text-xs">
              {{ t('api.tester.invalid_json', { message: bodyError }) }}
            </p>
            <p v-else class="text-dimmed mt-1.5 text-xs">
              {{
                route.contract.exampleBody
                  ? t('api.tester.prefilled')
                  : t('api.tester.empty_body')
              }}
            </p>
          </template>

          <template v-else-if="tab === 'headers' || tab === 'query'">
            <div class="flex flex-col gap-2">
              <div
                v-for="(entry, index) in tab === 'headers' ? headers : query"
                :key="entry.id"
                class="flex gap-2"
              >
                <UInput
                  v-model="entry.name"
                  size="sm"
                  class="w-2/5 font-mono"
                  :placeholder="t('api.tester.name')"
                  :aria-label="t('api.tester.name')"
                />
                <UInput
                  v-model="entry.value"
                  size="sm"
                  class="grow font-mono"
                  :placeholder="t('api.tester.value')"
                  :aria-label="t('api.tester.value')"
                />
                <UButton
                  size="sm"
                  color="neutral"
                  variant="ghost"
                  icon="i-ph-x"
                  :aria-label="t('api.tester.remove')"
                  @click="
                    (tab === 'headers' ? headers : query).splice(index, 1)
                  "
                />
              </div>
              <div>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="outline"
                  icon="i-ph-plus"
                  :label="
                    tab === 'headers'
                      ? t('api.tester.add_header')
                      : t('api.tester.add_query')
                  "
                  @click="(tab === 'headers' ? headers : query).push(row())"
                />
              </div>
              <p class="text-dimmed text-xs">
                {{
                  tab === 'headers'
                    ? t('api.tester.headers_hint')
                    : route.contract.queryParams.length
                      ? t('api.tester.query_known', {
                          names: route.contract.queryParams.join(', '),
                        })
                      : t('api.tester.query_none')
                }}
              </p>
            </div>
          </template>

          <template v-else>
            <p v-if="route.pathParams.length === 0" class="text-dimmed text-sm">
              {{ t('api.tester.no_path', { path: route.path }) }}
            </p>
            <div v-else class="flex flex-col gap-3">
              <DmsFieldRow
                v-for="name in route.pathParams"
                :key="name"
                :label="`:${name}`"
                :label-for="`api-path-${name}`"
                layout="form"
                spacing="list"
                :inset="false"
                required
              >
                <UFormField
                  :error="
                    pathValues[name] ? false : t('api.tester.path_required')
                  "
                >
                  <UInput
                    :id="`api-path-${name}`"
                    v-model="pathValues[name]"
                    size="sm"
                    class="w-full font-mono"
                  />
                </UFormField>
              </DmsFieldRow>
            </div>
          </template>
        </div>
      </DmsCard>

      <DmsCard :padded="false">
        <div v-if="!result" class="px-4 py-10">
          <DmsEmptyState
            size="sm"
            icon="i-ph-paper-plane-tilt"
            :title="t('api.tester.no_response_title')"
            :description="t('api.tester.no_response_description', { shortcut })"
          />
        </div>
        <template v-else>
          <div
            class="border-default flex flex-wrap items-center gap-3 border-b px-4 py-2.5"
          >
            <ApiStatusBadge v-if="result.status" :status="result.status" text />
            <DmsStatusPill
              v-else
              tone="error"
              dot="none"
              :label="t('api.tester.network_error')"
            />
            <span class="text-muted font-mono text-[12px]">
              {{ formatMs(result.durationMs, locale) }}
            </span>
            <span v-if="result.body" class="text-muted font-mono text-[12px]">
              {{ formatBytes(byteLength(result.body), locale) }}
            </span>
            <span class="grow" />
            <UButton
              :to="logsLink"
              size="xs"
              variant="link"
              trailing-icon="i-ph-arrow-right"
              :label="t('api.tester.open_logs')"
            />
          </div>
          <div class="p-3">
            <DmsBanner
              v-if="result.error"
              tone="error"
              size="sm"
              icon="i-ph-plugs"
              :title="t('api.tester.network_title')"
              :description="
                t('api.tester.network_description', { message: result.message })
              "
            />
            <DmsBanner
              v-else-if="result.status === 401 && !result.sentWithSession"
              tone="warning"
              size="sm"
              icon="i-ph-lock-simple"
              :title="t('api.tester.unauthorized_title')"
              :description="t('api.tester.unauthorized_description')"
            >
              <template #actions>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="outline"
                  :label="t('api.tester.turn_on_session')"
                  @click="useSession = true"
                />
              </template>
            </DmsBanner>
            <template v-if="!result.error">
              <UTabs
                v-model="responseTab"
                :items="responseTabs"
                :content="false"
                variant="link"
                size="sm"
                class="mb-2"
              />
              <ApiCode
                v-if="responseTab === 'body' && responseBody.text"
                :code="responseBody.text"
                max-height="24rem"
              />
              <p v-else-if="responseTab === 'body'" class="text-dimmed text-sm">
                {{ t('api.request.no_body') }}
              </p>
              <ApiKeyValues
                v-else
                :values="result.headers"
                :empty="t('api.request.no_headers')"
              />
            </template>
          </div>
        </template>
      </DmsCard>
    </div>

    <DmsCard :title="t('api.tester.history')" :padded="false">
      <template #actions>
        <span class="text-dimmed text-xs">
          {{ t('api.tester.history_hint') }}
        </span>
        <UButton
          v-if="history.length"
          size="xs"
          color="neutral"
          variant="ghost"
          :label="t('api.tester.clear')"
          @click="clearHistory"
        />
      </template>
      <p v-if="history.length === 0" class="text-dimmed px-4 py-4 text-sm">
        {{ t('api.tester.history_empty') }}
      </p>
      <ul v-else class="divide-default divide-y">
        <li v-for="entry in history" :key="entry.at">
          <button
            type="button"
            class="hover:bg-elevated flex w-full items-center gap-3 px-4 py-2 text-left text-[12.5px]"
            @click="restore(entry)"
          >
            <ApiStatusBadge
              v-if="entry.result.status"
              :status="entry.result.status"
              size="sm"
            />
            <DmsStatusPill
              v-else
              tone="error"
              dot="none"
              size="sm"
              label="ERR"
            />
            <span class="text-default min-w-0 grow truncate font-mono">
              {{ method }} {{ entry.path }}
            </span>
            <span v-if="!entry.useSession" class="text-dimmed text-xs">
              {{ t('api.tester.session_off') }}
            </span>
            <span class="text-muted font-mono text-[11px]">
              {{ formatMs(entry.result.durationMs, locale) }}
            </span>
            <span class="text-dimmed font-mono text-[11px]">
              {{ formatClock(entry.at, locale) }}
            </span>
          </button>
        </li>
      </ul>
    </DmsCard>
    <p class="sr-only" aria-live="polite">
      {{ result ? `${result.status} ${statusText(result.status)}` : '' }}
    </p>
  </div>
</template>
