<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  byteLength,
  formatBytes,
  formatClock,
  formatCount,
  formatDateTime,
  formatMs,
  prettyBody,
} from '../../utils/format'
import { toCurl } from '../../utils/snippets'
import { hasRequestBody } from '../../utils/http'
import ApiCode from '../internal/ApiCode.vue'
import ApiKeyValues from '../internal/ApiKeyValues.vue'
import ApiMethodBadge from '../internal/ApiMethodBadge.vue'
import ApiPath from '../internal/ApiPath.vue'
import ApiStatusBadge from '../internal/ApiStatusBadge.vue'

// One captured request, opened from a request table: the error and its stack
// first, then timing against the slow threshold, then what was sent and what
// came back. Every action leads somewhere: the tester, the route, the other
// requests that failed the same way.
defineOptions({ inheritAttrs: false })

interface RowNavigation {
  index: number
  total: number
  hasPrev: boolean
  hasNext: boolean
  prev: () => void
  next: () => void
}

interface RequestRow {
  _id: string
}

interface RequestLog {
  _id: string
  timestamp: string
  method: string
  uri: string
  rawPath: string
  route: string
  routeRegistered: boolean
  statusCode: number
  responseTimeMs: number
  slowThresholdMs: number
  ip?: string
  userAgent?: string
  pathParams?: Record<string, string>
  query?: Record<string, string | string[]>
  requestHeaders?: Record<string, string>
  requestBody?: string
  requestBodyTruncated?: boolean
  responseHeaders?: Record<string, string>
  responseBody?: string
  responseBodyTruncated?: boolean
  error?: { message: string; stack?: string }
  links: {
    route: string | null
    tester: string | null
    sameError: string | null
    sameRoute: string
  }
}

const props = defineProps<{
  rowData?: RequestRow
  navigation?: RowNavigation
  /** Closes the drawer (the table refreshes behind it). */
  onSuccessCallback?: () => void
}>()

// A link leaves the page the drawer belongs to: close it on the way out.
function leave() {
  props.onSuccessCallback?.()
}

const LOGS_API = '/api/monitoring/logs'
const REDACTED = '[REDACTED]'

const { t } = useI18n()
const apiOrigin = useApiOrigin()
const locale = useFormatLocale()
const toast = useToast()
const {
  data: log,
  error,
  pending,
  refresh,
} = useApiResource<RequestLog>(() =>
  props.rowData?._id
    ? `${LOGS_API}/${encodeURIComponent(props.rowData._id)}`
    : null,
)

const tab = ref('overview')
const tabs = computed(() => [
  { label: t('api.request.tabs.overview'), value: 'overview' },
  { label: t('api.request.tabs.request'), value: 'request' },
  { label: t('api.request.tabs.response'), value: 'response' },
])

const notFound = computed(() => {
  const status = errorStatus(error.value)
  return status === 404
})

const requestBody = computed(() => prettyBody(log.value?.requestBody))
const responseBody = computed(() => prettyBody(log.value?.responseBody))
const redactions = computed(
  () => (log.value?.requestBody?.split(REDACTED).length ?? 1) - 1,
)

const slowShare = computed(() => {
  const value = log.value
  if (!value || !value.slowThresholdMs) return 0
  return Math.min(100, (value.responseTimeMs / value.slowThresholdMs) * 100)
})
const isSlow = computed(
  () => !!log.value && log.value.responseTimeMs >= log.value.slowThresholdMs,
)

const curl = computed(() => {
  const value = log.value
  if (!value) return ''
  const origin = apiOrigin.value
  const headers = { ...(value.requestHeaders ?? {}) }
  delete headers.host
  delete headers['content-length']
  const search = new URLSearchParams()
  for (const [key, entry] of Object.entries(value.query ?? {})) {
    for (const item of Array.isArray(entry) ? entry : [entry])
      search.append(key, item)
  }
  const query = search.toString()
  return toCurl({
    method: value.method,
    url: `${origin}${value.rawPath}${query ? `?${query}` : ''}`,
    headers,
    body: hasRequestBody(value.method) ? value.requestBody : undefined,
  })
})

async function copyCurl() {
  try {
    await navigator.clipboard.writeText(curl.value)
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

const testerLink = computed(() =>
  log.value?.links.tester
    ? `${log.value.links.tester}&replay=${encodeURIComponent(log.value._id)}`
    : null,
)

const count = (value: number) => formatCount(value, locale.value)
</script>

<template>
  <div class="flex flex-col gap-5" :aria-busy="pending">
    <div
      v-if="navigation"
      class="text-dimmed flex items-center gap-2 font-mono text-[11px]"
    >
      <span>
        {{
          t('api.request.position', {
            index: navigation.index + 1,
            total: navigation.total,
          })
        }}
      </span>
      <span class="grow" />
      <UTooltip :text="t('api.request.previous')">
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-ph-caret-up"
          :disabled="!navigation.hasPrev"
          :aria-label="t('api.request.previous')"
          @click="navigation.prev()"
        />
      </UTooltip>
      <UTooltip :text="t('api.request.next')">
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-ph-caret-down"
          :disabled="!navigation.hasNext"
          :aria-label="t('api.request.next')"
          @click="navigation.next()"
        />
      </UTooltip>
    </div>

    <div v-if="pending" class="flex flex-col gap-3">
      <USkeleton class="h-6 w-2/3" />
      <USkeleton class="h-4 w-1/2" />
      <USkeleton class="h-28 w-full" />
    </div>

    <DmsEmptyState
      v-else-if="!log"
      variant="error"
      :title="
        notFound
          ? t('api.request.not_found_title')
          : t('api.request.error_title')
      "
      :description="
        notFound
          ? t('api.request.not_found_description')
          : t('api.request.error_description')
      "
      :actions="
        notFound
          ? []
          : [
              {
                label: t('api.common.retry'),
                icon: 'i-ph-arrow-clockwise',
                onClick: () => refresh(),
              },
            ]
      "
    />

    <template v-else>
      <header class="flex flex-col gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <ApiMethodBadge :method="log.method" />
          <ApiPath
            :path="log.rawPath"
            class="text-highlighted text-[15px] font-semibold"
          />
        </div>
        <div
          class="text-muted flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11.5px]"
        >
          <ApiStatusBadge :status="log.statusCode" text size="sm" />
          <span :class="isSlow ? 'text-warning font-semibold' : ''">
            {{ formatMs(log.responseTimeMs, locale) }}
          </span>
          <span>{{ formatClock(log.timestamp, locale, true) }}</span>
          <span class="inline-flex items-center gap-1">
            {{ log._id }}
            <DmsCopyButton :value="log._id" />
          </span>
          <span v-if="log.ip">{{ log.ip }}</span>
        </div>
        <div class="flex flex-wrap gap-2 pt-1">
          <UButton
            v-if="testerLink"
            :to="testerLink"
            size="sm"
            icon="i-ph-paper-plane-tilt"
            :label="t('api.request.replay')"
            @click="leave"
          />
          <UButton
            size="sm"
            color="neutral"
            variant="outline"
            icon="i-ph-terminal"
            :label="t('api.request.copy_curl')"
            @click="copyCurl"
          />
          <UButton
            v-if="log.links.route"
            :to="log.links.route"
            size="sm"
            color="neutral"
            variant="outline"
            icon="i-ph-tree-structure"
            :label="t('api.request.open_route')"
            @click="leave"
          />
          <UButton
            v-if="log.links.sameError"
            :to="log.links.sameError"
            size="sm"
            color="neutral"
            variant="ghost"
            icon="i-ph-copy-simple"
            :label="t('api.request.same_error')"
            @click="leave"
          />
        </div>
      </header>

      <UTabs
        v-model="tab"
        :items="tabs"
        :content="false"
        variant="link"
        size="sm"
      />

      <template v-if="tab === 'overview'">
        <section v-if="log.error" class="flex flex-col gap-2">
          <DmsEyebrow :label="t('api.request.error')" />
          <div class="border-error/40 bg-error/5 rounded-md border px-3 py-2.5">
            <p class="text-error break-words text-sm font-semibold">
              {{ log.error.message }}
            </p>
          </div>
          <ApiCode
            v-if="log.error.stack"
            :code="log.error.stack"
            max-height="14rem"
          />
        </section>

        <section class="flex flex-col gap-2">
          <DmsEyebrow :label="t('api.request.timing')" />
          <div class="flex items-baseline gap-2">
            <span class="text-highlighted font-mono text-xl font-semibold">
              {{ formatMs(log.responseTimeMs, locale) }}
            </span>
            <span class="text-dimmed text-xs">
              {{
                t('api.request.threshold', {
                  threshold: formatMs(log.slowThresholdMs, locale),
                })
              }}
            </span>
          </div>
          <div
            class="bg-elevated h-1.5 overflow-hidden rounded-full"
            role="meter"
            :aria-valuenow="log.responseTimeMs"
            :aria-valuemax="log.slowThresholdMs"
          >
            <div
              class="h-full rounded-full"
              :class="isSlow ? 'bg-warning' : 'bg-primary'"
              :style="{ width: `${slowShare}%` }"
            />
          </div>
        </section>

        <section class="flex flex-col gap-2">
          <DmsEyebrow :label="t('api.request.route')" />
          <p class="text-muted font-mono text-[12px]">
            {{ log.route }}
            <span v-if="!log.routeRegistered" class="text-dimmed">
              · {{ t('api.request.unmatched') }}
            </span>
          </p>
          <ApiKeyValues
            :values="log.pathParams"
            :empty="t('api.request.no_path_params')"
          />
        </section>

        <p class="text-dimmed text-xs">
          {{ formatDateTime(log.timestamp, locale) }} · {{ log.userAgent }}
        </p>
      </template>

      <template v-else-if="tab === 'request'">
        <section class="flex flex-col gap-2">
          <DmsEyebrow :label="t('api.request.headers')" />
          <ApiKeyValues
            :values="log.requestHeaders"
            :empty="t('api.request.no_headers')"
          />
          <p class="text-dimmed text-xs">{{ t('api.request.headers_hint') }}</p>
        </section>
        <section
          v-if="log.query && Object.keys(log.query).length"
          class="flex flex-col gap-2"
        >
          <DmsEyebrow :label="t('api.request.query')" />
          <ApiKeyValues :values="log.query" :empty="''" />
        </section>
        <section class="flex flex-col gap-2">
          <DmsEyebrow :label="t('api.request.body')" />
          <ApiCode
            v-if="requestBody.text"
            :code="requestBody.text"
            :label="`${requestBody.json ? 'JSON' : 'TEXT'} · ${formatBytes(byteLength(log.requestBody ?? ''), locale)}${log.requestBodyTruncated ? ` · ${t('api.request.truncated')}` : ''}`"
          />
          <p v-else class="text-dimmed text-sm">
            {{ t('api.request.no_body') }}
          </p>
          <p
            v-if="redactions > 0"
            class="text-dimmed inline-flex items-center gap-1 text-xs"
          >
            <UIcon name="i-ph-eye-slash" />
            {{
              t(
                'api.request.redacted',
                { count: count(redactions) },
                redactions,
              )
            }}
          </p>
        </section>
      </template>

      <template v-else>
        <section class="flex flex-col gap-2">
          <DmsEyebrow :label="t('api.request.headers')" />
          <ApiKeyValues
            :values="log.responseHeaders"
            :empty="t('api.request.no_headers')"
          />
        </section>
        <section class="flex flex-col gap-2">
          <DmsEyebrow :label="t('api.request.body')" />
          <ApiCode
            v-if="responseBody.text"
            :code="responseBody.text"
            :label="`${responseBody.json ? 'JSON' : 'TEXT'} · ${formatBytes(byteLength(log.responseBody ?? ''), locale)}${log.responseBodyTruncated ? ` · ${t('api.request.truncated')}` : ''}`"
          />
          <p v-else class="text-dimmed text-sm">
            {{ t('api.request.no_body') }}
          </p>
        </section>
      </template>
    </template>
  </div>
</template>
