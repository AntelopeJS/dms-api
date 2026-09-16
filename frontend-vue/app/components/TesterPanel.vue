<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type {
  ParameterInfo,
  RouteInspection,
} from '../composables/useApiIntrospection'
import { httpMethodColor } from '../utils/httpMethod'
import { sendTesterRequest, type TesterRequest } from '../utils/testerRequest'

interface HeaderRow {
  name: string
  value: string
  id: string
}

interface PathParamRow {
  name: string
  value: string
}

interface HistoryEntry {
  id: string
  timestamp: number
  method: string
  url: string
  headers: Record<string, string>
  body?: string
  pathParams?: Record<string, string>
  useSession?: boolean
  status?: number
  durationMs?: number
  responseSnippet?: string
  ok: boolean
}

const props = defineProps<{
  route: RouteInspection
}>()

const HISTORY_MAX = 25
const HISTORY_PREVIEW_BYTES = 200
const SUCCESS_STATUS_MIN = 200
const SUCCESS_STATUS_MAX = 300

const config = useDmsRuntimeConfig()
const { loggedIn } = useUserSession()

const baseURL = computed(() => {
  const dmsApi = (config.public as Record<string, unknown>).dmsApi as
    | { baseURL?: string }
    | undefined
  return dmsApi?.baseURL ?? ''
})

const useSessionAuth = ref(true)
const canUseSession = computed(() => loggedIn.value)

const pathParams = reactive<PathParamRow[]>([])
const headers = reactive<HeaderRow[]>([])
const requestBody = ref('')
const sending = ref(false)
const response = ref<{
  status: number
  durationMs: number
  headers: Record<string, string>
  body: string
  bodyIsJson: boolean
  error?: string
} | null>(null)
const history = ref<HistoryEntry[]>([])

const methodHasBody = computed(() =>
  /^(?:post|put|patch|delete)$/i.test(props.route.method),
)

const renderedUrl = computed(() => {
  let url = props.route.location
  for (const { name, value } of pathParams) {
    if (!name) continue
    url = url.replace(`:${name}`, encodeURIComponent(value || `:${name}`))
  }
  return url.startsWith('/') ? url : `/${url}`
})

const fullUrl = computed(() => `${baseURL.value}${renderedUrl.value}`)

const methodBadgeColor = computed(() => httpMethodColor(props.route.method))

function historyKey(routeId: string): string {
  return `dmsApi.tester.history.${routeId}`
}

function loadHistory() {
  if (typeof window === 'undefined') return
  try {
    const raw = window.localStorage.getItem(historyKey(props.route.id))
    history.value = raw ? (JSON.parse(raw) as HistoryEntry[]) : []
  } catch {
    history.value = []
  }
}

function saveHistory() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      historyKey(props.route.id),
      JSON.stringify(history.value.slice(0, HISTORY_MAX)),
    )
  } catch {
    /* quota or disabled storage — ignore */
  }
}

function pathParamsFromLocation(location: string): string[] {
  const out: string[] = []
  for (const seg of location.split('/')) {
    if (seg.startsWith(':')) out.push(seg.slice(1))
    else if (seg.startsWith('::')) out.push(seg.slice(2))
  }
  return out
}

function nameOf(p: ParameterInfo): string {
  return p.name ?? `param_${p.index}`
}

function cryptoId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function resetFromRoute() {
  pathParams.length = 0
  for (const name of pathParamsFromLocation(props.route.location)) {
    pathParams.push({ name, value: '' })
  }

  headers.length = 0
  if (methodHasBody.value) {
    headers.push({
      name: 'Content-Type',
      value: 'application/json',
      id: cryptoId(),
    })
  }

  const bodyParam = props.route.parameters.find((p) => p.source === 'body')
  if (methodHasBody.value && bodyParam) {
    requestBody.value = '{\n  \n}'
  } else {
    requestBody.value = ''
  }

  for (const p of props.route.parameters) {
    if (p.source === 'header') {
      headers.push({ name: nameOf(p), value: '', id: cryptoId() })
    }
  }

  response.value = null
}

function addHeader() {
  headers.push({ name: '', value: '', id: cryptoId() })
}

function removeHeader(id: string) {
  const idx = headers.findIndex((h) => h.id === id)
  if (idx >= 0) headers.splice(idx, 1)
}

function buildHeaderRecord(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const h of headers) {
    if (!h.name) continue
    out[h.name] = h.value
  }
  return out
}

function buildPathParamRecord(): Record<string, string> {
  return Object.fromEntries(pathParams.map(({ name, value }) => [name, value]))
}

function handleTesterResponse(
  result: Awaited<ReturnType<typeof sendTesterRequest>>,
  request: TesterRequest,
  url: string,
  started: number,
) {
  const durationMs = Math.round(performance.now() - started)
  const isJson = /json/i.test(result.headers['content-type'] ?? '')
  response.value = {
    status: result.status,
    durationMs,
    headers: result.headers,
    body: isJson ? safePretty(result.body) : result.body,
    bodyIsJson: isJson,
  }
  pushHistory({
    id: cryptoId(),
    timestamp: Date.now(),
    method: request.method,
    url,
    headers: request.headers,
    body: methodHasBody.value ? requestBody.value : undefined,
    pathParams: buildPathParamRecord(),
    useSession: request.useSession,
    status: result.status,
    durationMs,
    responseSnippet: result.body.slice(0, HISTORY_PREVIEW_BYTES),
    ok:
      result.status >= SUCCESS_STATUS_MIN && result.status < SUCCESS_STATUS_MAX,
  })
}

function handleTesterError(
  error: unknown,
  request: TesterRequest,
  url: string,
  started: number,
) {
  const durationMs = Math.round(performance.now() - started)
  const message = error instanceof Error ? error.message : String(error)
  response.value = {
    status: 0,
    durationMs,
    headers: {},
    body: message,
    bodyIsJson: false,
    error: message,
  }
  pushHistory({
    id: cryptoId(),
    timestamp: Date.now(),
    method: request.method,
    url,
    headers: request.headers,
    body: methodHasBody.value ? requestBody.value : undefined,
    pathParams: buildPathParamRecord(),
    useSession: request.useSession,
    durationMs,
    responseSnippet: message,
    ok: false,
  })
}

async function send() {
  if (sending.value) return
  sending.value = true
  response.value = null
  const url = fullUrl.value
  const request: TesterRequest = {
    method: props.route.method.toUpperCase(),
    headers: buildHeaderRecord(),
    useSession: useSessionAuth.value && canUseSession.value,
  }
  if (methodHasBody.value && requestBody.value.trim().length > 0) {
    request.body = requestBody.value
  }

  const started = performance.now()
  try {
    const result = await sendTesterRequest(url, window.location.origin, request)
    handleTesterResponse(result, request, url, started)
  } catch (error) {
    handleTesterError(error, request, url, started)
  } finally {
    sending.value = false
  }
}

function pushHistory(entry: HistoryEntry) {
  history.value.unshift(entry)
  if (history.value.length > HISTORY_MAX) history.value.length = HISTORY_MAX
  saveHistory()
}

function recall(entry: HistoryEntry) {
  headers.length = 0
  for (const [name, value] of Object.entries(entry.headers)) {
    headers.push({ name, value, id: cryptoId() })
  }
  for (const pathParam of pathParams) {
    pathParam.value = entry.pathParams?.[pathParam.name] ?? pathParam.value
  }
  if (entry.body !== undefined) requestBody.value = entry.body
  if (entry.useSession !== undefined) useSessionAuth.value = entry.useSession
}

function clearHistory() {
  history.value = []
  saveHistory()
}

function safePretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function statusColor(s?: number): string {
  if (!s || s === 0) return 'error'
  if (s >= 500) return 'error'
  if (s >= 400) return 'warning'
  if (s >= 300) return 'info'
  return 'success'
}

watch(
  () => props.route.id,
  () => {
    resetFromRoute()
    loadHistory()
  },
  { immediate: true },
)

onMounted(loadHistory)
</script>

<template>
  <div class="flex w-full flex-col gap-4">
    <!-- URL preview + send -->
    <div class="flex flex-wrap items-center gap-2">
      <UBadge :color="methodBadgeColor" variant="solid">
        {{ route.method.toUpperCase() }}
      </UBadge>
      <code
        class="bg-elevated text-highlighted grow rounded px-3 py-2 font-mono text-sm"
      >
        {{ fullUrl }}
      </code>
      <UButton
        :loading="sending"
        :disabled="sending"
        color="primary"
        icon="i-ph-paper-plane-tilt"
        @click="send"
      >
        {{ $t('page.api.routes.tester.send') }}
      </UButton>
    </div>

    <!-- Auth toggle -->
    <label
      class="text-muted flex items-center gap-2 self-start text-xs"
      :class="{ 'opacity-60': !canUseSession }"
    >
      <USwitch v-model="useSessionAuth" :disabled="!canUseSession" size="xs" />
      <span class="flex items-center gap-1">
        <UIcon name="i-ph-shield-check" />
        {{ $t('page.api.routes.tester.use_current_user') }}
      </span>
      <span class="text-dimmed">
        {{
          canUseSession
            ? $t('page.api.routes.tester.use_current_user_description')
            : $t('page.api.routes.tester.auth_unavailable')
        }}
      </span>
    </label>

    <!-- Path params -->
    <section v-if="pathParams.length > 0" class="flex flex-col gap-2">
      <h4 class="text-highlighted text-sm font-semibold">
        {{ $t('page.api.routes.tester.path_params') }}
      </h4>
      <div
        v-for="(p, idx) in pathParams"
        :key="p.name + idx"
        class="grid grid-cols-[160px_1fr] gap-3"
      >
        <code class="text-muted self-center font-mono text-xs">
          :{{ p.name }}
        </code>
        <UInput v-model="p.value" :placeholder="p.name" />
      </div>
    </section>

    <!-- Headers -->
    <section class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <h4 class="text-highlighted text-sm font-semibold">
          {{ $t('page.api.routes.tester.headers') }}
        </h4>
        <UButton size="xs" variant="ghost" icon="i-ph-plus" @click="addHeader">
          {{ $t('page.api.routes.tester.add_header') }}
        </UButton>
      </div>
      <div
        v-for="h in headers"
        :key="h.id"
        class="grid grid-cols-[1fr_2fr_auto] gap-2"
      >
        <UInput
          v-model="h.name"
          :placeholder="$t('page.api.routes.tester.header_name')"
        />
        <UInput
          v-model="h.value"
          :placeholder="$t('page.api.routes.tester.header_value')"
        />
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-ph-x"
          @click="removeHeader(h.id)"
        />
      </div>
      <p v-if="headers.length === 0" class="text-dimmed text-xs">
        {{ $t('page.api.routes.tester.no_headers') }}
      </p>
    </section>

    <!-- Body -->
    <section v-if="methodHasBody" class="flex flex-col gap-2">
      <h4 class="text-highlighted text-sm font-semibold">
        {{ $t('page.api.routes.tester.body') }}
      </h4>
      <UTextarea v-model="requestBody" :rows="8" class="font-mono text-xs" />
    </section>

    <!-- Response panel -->
    <section v-if="response" class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <h4 class="text-highlighted text-sm font-semibold">
          {{ $t('page.api.routes.tester.response') }}
        </h4>
        <UBadge :color="statusColor(response.status)" variant="subtle">
          {{ response.status || $t('page.api.routes.tester.network_error') }}
        </UBadge>
        <span class="text-dimmed text-xs">{{ response.durationMs }} ms</span>
      </div>

      <div
        v-if="Object.keys(response.headers).length > 0"
        class="flex flex-col gap-1"
      >
        <p class="text-dimmed text-xs uppercase">
          {{ $t('page.api.routes.tester.response_headers') }}
        </p>
        <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
          <template v-for="(value, name) in response.headers" :key="name">
            <dt class="text-muted font-mono">{{ name }}</dt>
            <dd class="break-all font-mono">{{ value }}</dd>
          </template>
        </dl>
      </div>

      <div class="flex flex-col gap-1">
        <p class="text-dimmed text-xs uppercase">
          {{ $t('page.api.routes.tester.response_body') }}
        </p>
        <pre class="bg-elevated max-h-96 overflow-auto rounded p-3 text-xs">{{
          response.body
        }}</pre>
      </div>
    </section>

    <!-- History -->
    <section v-if="history.length > 0" class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <h4 class="text-highlighted text-sm font-semibold">
          {{ $t('page.api.routes.tester.history') }}
        </h4>
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-ph-trash"
          @click="clearHistory"
        >
          {{ $t('page.api.routes.tester.clear_history') }}
        </UButton>
      </div>
      <ul class="space-y-1">
        <li
          v-for="entry in history"
          :key="entry.id"
          class="border-default bg-elevated/40 hover:bg-elevated flex cursor-pointer items-center gap-3 rounded border px-3 py-2"
          @click="recall(entry)"
        >
          <UBadge :color="statusColor(entry.status)" variant="subtle" size="xs">
            {{ entry.status || 'ERR' }}
          </UBadge>
          <span class="text-dimmed text-xs">{{ entry.durationMs }} ms</span>
          <span class="grow truncate font-mono text-xs">{{ entry.url }}</span>
          <span class="text-dimmed text-xs">
            {{ new Date(entry.timestamp).toLocaleTimeString() }}
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>
