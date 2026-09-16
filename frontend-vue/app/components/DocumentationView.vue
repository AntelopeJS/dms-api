<script setup lang="ts">
import { computed } from 'vue'
import type {
  InferredType,
  ParameterInfo,
  ParameterSource,
  RouteDocPayload,
} from '../composables/useApiIntrospection'

const props = defineProps<{
  doc: RouteDocPayload
}>()

interface ParamGroup {
  source: ParameterSource
  title: string
  description: string
  rows: ParameterInfo[]
}

const SOURCE_META: Record<
  ParameterSource,
  { title: string; description: string; order: number }
> = {
  param: { title: 'page.api.routes.doc.path_params', description: 'page.api.routes.doc.path_params_description', order: 0 },
  query: { title: 'page.api.routes.doc.query_params', description: 'page.api.routes.doc.query_params_description', order: 1 },
  header: { title: 'page.api.routes.doc.headers', description: 'page.api.routes.doc.headers_description', order: 2 },
  body: { title: 'page.api.routes.doc.body', description: 'page.api.routes.doc.body_description', order: 3 },
  raw: { title: 'page.api.routes.doc.raw_body', description: 'page.api.routes.doc.raw_body_description', order: 4 },
  context: { title: 'page.api.routes.doc.context', description: 'page.api.routes.doc.context_description', order: 5 },
  result: { title: 'page.api.routes.doc.result', description: 'page.api.routes.doc.result_description', order: 6 },
  stream: { title: 'page.api.routes.doc.stream', description: 'page.api.routes.doc.stream_description', order: 7 },
  connection: { title: 'page.api.routes.doc.connection', description: 'page.api.routes.doc.connection_description', order: 8 },
  unknown: { title: 'page.api.routes.doc.unknown_params', description: 'page.api.routes.doc.unknown_params_description', order: 9 },
}

const TYPE_COLOR: Record<InferredType, 'neutral' | 'primary' | 'success' | 'warning' | 'info'> = {
  string: 'neutral',
  number: 'primary',
  boolean: 'success',
  object: 'info',
  buffer: 'warning',
  stream: 'warning',
  unknown: 'neutral',
}

const groups = computed<ParamGroup[]>(() => {
  const buckets = new Map<ParameterSource, ParameterInfo[]>()
  for (const param of props.doc.parameters) {
    const list = buckets.get(param.source) ?? []
    list.push(param)
    buckets.set(param.source, list)
  }
  return [...buckets.entries()]
    .map(([source, rows]) => ({
      source,
      title: SOURCE_META[source].title,
      description: SOURCE_META[source].description,
      rows,
    }))
    .sort((a, b) => SOURCE_META[a.source].order - SOURCE_META[b.source].order)
})

const authMiddleware = computed(() =>
  props.doc.applicableMiddleware.filter((m) => m.isAuth),
)

const errorCodes = computed(() => props.doc.errorCodes ?? [])

function statusColor(s: number): 'warning' | 'error' {
  return s >= 500 ? 'error' : 'warning'
}
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <p class="text-sm text-muted">
      {{ $t('page.api.routes.doc.handler_label') }}:
      <code class="font-mono">{{ doc.callbackName }}</code>
    </p>

    <!-- Authentication summary -->
    <section class="flex flex-col gap-2">
      <h3 class="text-base font-semibold text-highlighted">
        {{ $t('page.api.routes.doc.authentication') }}
      </h3>
      <ul v-if="authMiddleware.length > 0" class="flex flex-col gap-1 text-sm">
        <li
          v-for="m in authMiddleware"
          :key="m.id"
          class="flex flex-wrap items-center gap-2"
        >
          <UBadge color="warning" variant="subtle" size="xs">auth</UBadge>
          <code class="font-mono">{{ m.callbackName }}</code>
          <span class="text-dimmed text-xs">
            {{ m.location }} · {{ m.mode }}
          </span>
        </li>
      </ul>
      <p v-else class="text-sm text-muted">
        {{ $t('page.api.routes.doc.no_authentication') }}
      </p>
    </section>

    <!-- Parameter groups -->
    <section v-for="group in groups" :key="group.source" class="flex flex-col gap-2">
      <h3 class="text-base font-semibold text-highlighted">
        {{ $t(group.title) }}
      </h3>
      <p class="text-sm text-muted">
        {{ $t(group.description) }}
      </p>
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="border-b border-default text-left text-xs uppercase text-dimmed">
            <th class="py-2 pr-4">{{ $t('page.api.routes.doc.col_name') }}</th>
            <th class="py-2 pr-4">{{ $t('page.api.routes.doc.col_type') }}</th>
            <th class="py-2 pr-4">{{ $t('page.api.routes.doc.col_index') }}</th>
            <th class="py-2 pr-4">{{ $t('page.api.routes.doc.col_modifiers') }}</th>
            <th class="py-2">{{ $t('page.api.routes.doc.col_source') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in group.rows" :key="row.index" class="border-b border-muted/40">
            <td class="py-2 pr-4 font-mono">
              {{ row.name ?? $t('page.api.routes.doc.unnamed') }}
              <UBadge v-if="row.multi" color="neutral" variant="subtle" size="xs">multi</UBadge>
            </td>
            <td class="py-2 pr-4">
              <UBadge :color="TYPE_COLOR[row.inferredType]" variant="subtle" size="xs">
                {{ row.inferredType }}
              </UBadge>
            </td>
            <td class="py-2 pr-4 text-dimmed">{{ row.index }}</td>
            <td class="py-2 pr-4 text-dimmed">{{ row.modifierCount }}</td>
            <td class="py-2">
              <code class="font-mono text-xs text-muted">{{ row.source }}</code>
              <UBadge
                v-if="row.hint"
                color="info"
                variant="subtle"
                size="xs"
                class="ml-2"
              >
                {{ row.hint }}
              </UBadge>
              <details v-if="row.rawProviderSource" class="mt-1 text-xs">
                <summary class="cursor-pointer text-dimmed">
                  {{ $t('page.api.routes.doc.show_source') }}
                </summary>
                <pre class="mt-1 max-h-32 overflow-auto rounded bg-elevated p-2 text-[10px]">{{ row.rawProviderSource }}</pre>
              </details>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Narrative documentation placeholder -->
    <section class="flex flex-col gap-2">
      <h3 class="text-base font-semibold text-highlighted">
        {{ $t('page.api.routes.doc.narrative') }}
      </h3>
      <div class="flex flex-col items-center gap-2 rounded border border-dashed border-default p-6 text-center">
        <UIcon name="i-ph-book-open" class="text-2xl text-muted" />
        <p class="text-sm font-medium text-highlighted">
          {{ $t('page.api.routes.doc.narrative_pending_title') }}
        </p>
        <p class="max-w-md text-xs text-muted">
          {{ $t('page.api.routes.doc.narrative_pending_description') }}
        </p>
      </div>
    </section>

    <!-- Error responses (inferred) -->
    <section v-if="errorCodes.length > 0" class="flex flex-col gap-2">
      <h3 class="text-base font-semibold text-highlighted">
        {{ $t('page.api.routes.doc.error_responses') }}
      </h3>
      <p class="text-sm text-muted">
        {{ $t('page.api.routes.doc.error_responses_description') }}
      </p>
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="border-b border-default text-left text-xs uppercase text-dimmed">
            <th class="py-2 pr-4">{{ $t('page.api.routes.doc.col_status') }}</th>
            <th class="py-2 pr-4">{{ $t('page.api.routes.doc.col_reason') }}</th>
            <th class="py-2">{{ $t('page.api.routes.doc.col_source') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="ec in errorCodes" :key="ec.status" class="border-b border-muted/40">
            <td class="py-2 pr-4">
              <UBadge :color="statusColor(ec.status)" variant="subtle" size="xs">
                {{ ec.status }}
              </UBadge>
            </td>
            <td class="py-2 pr-4 text-sm">
              <span v-if="ec.reason" class="text-highlighted">{{ ec.reason }}</span>
              <span v-else class="text-dimmed">—</span>
            </td>
            <td class="py-2 font-mono text-xs text-muted">{{ ec.source }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Response shape placeholder -->
    <section class="flex flex-col gap-2">
      <h3 class="text-base font-semibold text-highlighted">
        {{ $t('page.api.routes.doc.response') }}
      </h3>
      <div class="flex flex-col items-center gap-2 rounded border border-dashed border-default p-6 text-center">
        <UIcon name="i-ph-arrow-square-out" class="text-2xl text-muted" />
        <p class="text-sm font-medium text-highlighted">
          {{ $t('page.api.routes.doc.response_pending_title') }}
        </p>
        <p class="max-w-md text-xs text-muted">
          {{ $t('page.api.routes.doc.response_pending_description') }}
        </p>
      </div>
    </section>
  </div>
</template>
