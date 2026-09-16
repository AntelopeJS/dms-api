<script setup lang="ts">
import { computed } from 'vue'
import type { FullRequestLog } from '../composables/useApiIntrospection'
import { httpMethodColor } from '../utils/httpMethod'

const props = defineProps<{
  log: FullRequestLog
}>()

const statusColor = computed(() => {
  const s = props.log.statusCode
  if (s >= 500) return 'error'
  if (s >= 400) return 'warning'
  if (s >= 300) return 'info'
  return 'success'
})

const methodColor = computed(() => httpMethodColor(props.log.method))

const formattedTimestamp = computed(() =>
  new Date(props.log.timestamp).toLocaleString(),
)

const responseTimeMs = computed(
  () => Math.round(props.log.responseTimeMs * 100) / 100,
)

function prettyJson(text?: string): string {
  if (!text) return ''
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function entries(rec?: Record<string, unknown>): Array<[string, string]> {
  if (!rec) return []
  return Object.entries(rec).map(([k, v]) => [
    k,
    Array.isArray(v) ? v.join(', ') : String(v),
  ])
}
</script>

<template>
  <div class="flex flex-col gap-4 p-1">
    <!-- Top: method + uri + timestamp + status + duration -->
    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <UBadge :color="methodColor" variant="solid">
          {{ log.method.toUpperCase() }}
        </UBadge>
        <code class="rounded bg-elevated px-2 py-1 text-sm font-mono text-highlighted">
          {{ log.uri }}
        </code>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <UBadge :color="statusColor" variant="subtle">
          {{ log.statusCode }}
        </UBadge>
        <span class="text-xs text-dimmed">{{ responseTimeMs }} ms</span>
        <span class="text-xs text-dimmed">·</span>
        <span class="text-xs text-dimmed">{{ formattedTimestamp }}</span>
        <span v-if="log.ip" class="text-xs text-dimmed">· {{ log.ip }}</span>
      </div>
      <p
        v-if="log.rawPath && log.rawPath !== log.uri"
        class="text-xs text-muted"
      >
        {{ $t('page.api.routes.stats.raw_path') }}:
        <code class="font-mono">{{ log.rawPath }}</code>
      </p>
    </div>

    <USeparator />

    <!-- Error -->
    <section v-if="log.error" class="flex flex-col gap-2">
      <h4 class="text-sm font-semibold text-error">
        {{ $t('page.api.routes.stats.detail_error') }}
      </h4>
      <p class="text-sm">{{ log.error.message }}</p>
      <pre
        v-if="log.error.stack"
        class="max-h-48 overflow-auto rounded bg-elevated p-2 text-[10px]"
      >{{ log.error.stack }}</pre>
    </section>

    <!-- Request -->
    <section class="flex flex-col gap-3">
      <h4 class="text-sm font-semibold text-highlighted">
        {{ $t('page.api.routes.stats.detail_request') }}
      </h4>

      <div v-if="entries(log.pathParams).length > 0" class="flex flex-col gap-1">
        <p class="text-xs uppercase text-dimmed">
          {{ $t('page.api.routes.stats.detail_path_params') }}
        </p>
        <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
          <template v-for="[k, v] in entries(log.pathParams)" :key="k">
            <dt class="font-mono text-muted">{{ k }}</dt>
            <dd class="font-mono">{{ v }}</dd>
          </template>
        </dl>
      </div>

      <div v-if="entries(log.query).length > 0" class="flex flex-col gap-1">
        <p class="text-xs uppercase text-dimmed">
          {{ $t('page.api.routes.stats.detail_query') }}
        </p>
        <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
          <template v-for="[k, v] in entries(log.query)" :key="k">
            <dt class="font-mono text-muted">{{ k }}</dt>
            <dd class="font-mono">{{ v }}</dd>
          </template>
        </dl>
      </div>

      <div v-if="entries(log.requestHeaders).length > 0" class="flex flex-col gap-1">
        <p class="text-xs uppercase text-dimmed">
          {{ $t('page.api.routes.stats.detail_headers') }}
        </p>
        <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
          <template v-for="[k, v] in entries(log.requestHeaders)" :key="k">
            <dt class="font-mono text-muted">{{ k }}</dt>
            <dd class="font-mono break-all">{{ v }}</dd>
          </template>
        </dl>
      </div>

      <div v-if="log.requestBody" class="flex flex-col gap-1">
        <p class="text-xs uppercase text-dimmed">
          {{ $t('page.api.routes.stats.detail_body') }}
          <span v-if="log.requestBodyTruncated" class="text-warning">
            ({{ $t('page.api.routes.stats.truncated') }})
          </span>
        </p>
        <pre class="max-h-48 overflow-auto rounded bg-elevated p-2 text-[10px]">{{ prettyJson(log.requestBody) }}</pre>
      </div>
    </section>

    <USeparator />

    <!-- Response -->
    <section class="flex flex-col gap-3">
      <h4 class="text-sm font-semibold text-highlighted">
        {{ $t('page.api.routes.stats.detail_response') }}
      </h4>

      <div v-if="entries(log.responseHeaders).length > 0" class="flex flex-col gap-1">
        <p class="text-xs uppercase text-dimmed">
          {{ $t('page.api.routes.stats.detail_headers') }}
        </p>
        <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
          <template v-for="[k, v] in entries(log.responseHeaders)" :key="k">
            <dt class="font-mono text-muted">{{ k }}</dt>
            <dd class="font-mono break-all">{{ v }}</dd>
          </template>
        </dl>
      </div>

      <div v-if="log.responseBody" class="flex flex-col gap-1">
        <p class="text-xs uppercase text-dimmed">
          {{ $t('page.api.routes.stats.detail_body') }}
          <span v-if="log.responseBodyTruncated" class="text-warning">
            ({{ $t('page.api.routes.stats.truncated') }})
          </span>
        </p>
        <pre class="max-h-64 overflow-auto rounded bg-elevated p-2 text-[10px]">{{ prettyJson(log.responseBody) }}</pre>
      </div>

      <p v-if="!log.responseBody" class="text-xs italic text-dimmed">
        {{ $t('page.api.routes.stats.detail_no_body') }}
      </p>
    </section>
  </div>
</template>
