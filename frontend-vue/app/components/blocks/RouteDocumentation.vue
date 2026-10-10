<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatCount } from '../../utils/format'
import { hasRequestBody, statusText } from '../../utils/http'
import { toCurl, toFetch } from '../../utils/snippets'
import ApiCode from '../internal/ApiCode.vue'
import ApiStatusBadge from '../internal/ApiStatusBadge.vue'

// The contract of a route, read first: how to call it, who may, what it
// expects and what it answers. Fields are inferred from the requests the
// console captured, error codes from the handler's source; the controller's
// internals stay folded at the end.
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{ fetchUrl: string; queryKey?: string }>(),
  {
    queryKey: 'route',
  },
)

type SnippetKind = 'curl' | 'fetch'

interface ResponseRow {
  status: number
  label: string
  detail: string
  count?: number
}

const { t } = useI18n()
const apiOrigin = useApiOrigin()
const locale = useFormatLocale()
const currentRoute = useDmsRoute()
const router = useDmsRouter()
const {
  data: route,
  pending,
  selection,
} = useRouteDetail(props.fetchUrl, props.queryKey)

const snippetKind = ref<SnippetKind>('curl')
const snippetItems = [
  { label: 'cURL', value: 'curl' },
  { label: 'fetch', value: 'fetch' },
]

const withBody = computed(() => hasRequestBody(route.value?.method))

const exampleBody = computed(() => {
  const body = route.value?.contract.exampleBody
  return body ? JSON.stringify(body, null, 2) : ''
})

const snippet = computed(() => {
  const value = route.value
  if (!value) return ''
  const origin = apiOrigin.value
  const headers: Record<string, string> = {}
  if (value.requiresAuth) headers.authorization = 'Bearer $TOKEN'
  if (withBody.value) headers['content-type'] = 'application/json'
  const request = {
    method: value.method,
    url: `${origin}${value.path}`,
    headers,
    body: withBody.value
      ? JSON.stringify(value.contract.exampleBody ?? {})
      : undefined,
  }
  return snippetKind.value === 'curl' ? toCurl(request) : toFetch(request)
})

const headerParams = computed(() =>
  (route.value?.inspection.parameters ?? []).filter(
    (parameter) => parameter.source === 'header',
  ),
)

const queryParams = computed(() => {
  const value = route.value
  if (!value) return []
  const declared = value.inspection.parameters
    .filter((parameter) => parameter.source === 'query' && parameter.name)
    .map((parameter) => parameter.name as string)
  return [...new Set([...declared, ...value.contract.queryParams])].sort()
})

const responses = computed<ResponseRow[]>(() => {
  const value = route.value
  if (!value) return []
  const rows = new Map<number, ResponseRow>()
  for (const observed of value.contract.statuses) {
    rows.set(observed.status, {
      status: observed.status,
      label: observed.message ?? statusText(observed.status),
      detail: t(
        'api.routes.docs.observed',
        { count: formatCount(observed.count, locale.value) },
        observed.count,
      ),
      count: observed.count,
    })
  }
  for (const inferred of value.inspection.errorCodes) {
    const existing = rows.get(inferred.status)
    const source = t(
      `api.routes.docs.source_${inferred.source === 'assert' ? 'assert' : 'result'}`,
    )
    rows.set(inferred.status, {
      status: inferred.status,
      label: existing?.label || inferred.reason || statusText(inferred.status),
      detail: existing ? `${existing.detail} · ${source}` : source,
      count: existing?.count,
    })
  }
  return [...rows.values()].sort((a, b) => a.status - b.status)
})

const PIPELINE_TONE = {
  prefix: 'info',
  handler: 'primary',
  postfix: 'neutral',
  monitor: 'neutral',
} as const

function openTester() {
  void router.push({ query: { ...currentRoute.query, tab: '2' } })
}
</script>

<template>
  <div v-if="!selection.ref.value" />
  <div v-else-if="pending" class="flex flex-col gap-4">
    <USkeleton class="h-40" />
    <USkeleton class="h-56" />
  </div>
  <div
    v-else-if="route"
    class="grid gap-4 2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
  >
    <div class="flex min-w-0 flex-col gap-4">
      <DmsCard :title="t('api.routes.docs.example')">
        <template #actions>
          <DmsSegmented
            v-model="snippetKind"
            :items="snippetItems"
            size="xs"
            variant="mono"
          />
          <UButton
            size="xs"
            icon="i-ph-paper-plane-tilt"
            :label="t('api.routes.docs.try')"
            @click="openTester"
          />
        </template>
        <ApiCode :code="snippet" max-height="16rem" />
        <ApiCode
          v-if="exampleBody"
          :code="exampleBody"
          :label="t('api.routes.docs.example_body')"
          class="mt-3"
          max-height="16rem"
        />
      </DmsCard>

      <DmsBanner
        :tone="route.requiresAuth ? 'info' : 'warning'"
        size="sm"
        :icon="route.requiresAuth ? 'i-ph-lock-simple' : 'i-ph-globe-simple'"
        :title="
          route.requiresAuth
            ? t('api.routes.docs.auth_title')
            : t('api.routes.docs.public_title')
        "
        :description="
          route.requiresAuth
            ? t('api.routes.docs.auth_description')
            : t('api.routes.docs.public_description')
        "
      />

      <DmsCard v-if="withBody" :title="t('api.routes.docs.body')">
        <template #actions>
          <DmsStatusPill
            v-if="route.contract.bodyFields.length"
            tone="info"
            dot="none"
            size="sm"
            :label="
              t(
                'api.routes.docs.inferred',
                { count: route.contract.sampled },
                route.contract.sampled,
              )
            "
          />
        </template>
        <p
          v-if="route.contract.bodyFields.length === 0"
          class="text-dimmed text-sm"
        >
          {{ t('api.routes.docs.no_body') }}
        </p>
        <ul v-else class="divide-default divide-y">
          <li
            v-for="field in route.contract.bodyFields"
            :key="field.name"
            class="flex items-center gap-3 py-2"
          >
            <span class="text-highlighted font-mono text-[13px]">
              {{ field.name }}
            </span>
            <DmsStatusPill
              :tone="field.required ? 'warning' : 'neutral'"
              dot="none"
              size="sm"
              :label="
                field.required
                  ? t('api.routes.docs.required')
                  : t('api.routes.docs.optional')
              "
            />
            <span class="grow" />
            <span class="text-muted font-mono text-[12px]">
              {{ field.types.join(' | ') }}
            </span>
          </li>
        </ul>
      </DmsCard>

      <DmsCard :title="t('api.routes.docs.parameters')">
        <dl class="grid gap-3 text-sm">
          <div>
            <dt
              class="text-dimmed font-mono text-[10.5px] uppercase tracking-[0.08em]"
            >
              {{ t('api.routes.docs.path') }}
            </dt>
            <dd class="mt-1 flex flex-wrap gap-1.5">
              <span v-if="route.pathParams.length === 0" class="text-dimmed">
                {{ t('api.routes.docs.none') }}
              </span>
              <code
                v-for="name in route.pathParams"
                :key="name"
                class="text-primary bg-elevated rounded px-1.5 py-0.5 font-mono text-[12px]"
              >
                :{{ name }}
              </code>
            </dd>
          </div>
          <div>
            <dt
              class="text-dimmed font-mono text-[10.5px] uppercase tracking-[0.08em]"
            >
              {{ t('api.routes.docs.query') }}
            </dt>
            <dd class="mt-1 flex flex-wrap gap-1.5">
              <span v-if="queryParams.length === 0" class="text-dimmed">
                {{ t('api.routes.docs.none') }}
              </span>
              <code
                v-for="name in queryParams"
                :key="name"
                class="bg-elevated rounded px-1.5 py-0.5 font-mono text-[12px]"
              >
                {{ name }}
              </code>
            </dd>
          </div>
          <div>
            <dt
              class="text-dimmed font-mono text-[10.5px] uppercase tracking-[0.08em]"
            >
              {{ t('api.routes.docs.headers') }}
            </dt>
            <dd class="mt-1 flex flex-wrap gap-1.5">
              <span v-if="headerParams.length === 0" class="text-dimmed">
                {{ t('api.routes.docs.none') }}
              </span>
              <code
                v-for="parameter in headerParams"
                :key="parameter.index"
                class="bg-elevated rounded px-1.5 py-0.5 font-mono text-[12px]"
              >
                {{ parameter.name }}
              </code>
            </dd>
          </div>
        </dl>
      </DmsCard>
    </div>

    <div class="flex min-w-0 flex-col gap-4">
      <DmsCard :title="t('api.routes.docs.responses')" :padded="false">
        <p v-if="responses.length === 0" class="text-dimmed px-4 py-4 text-sm">
          {{ t('api.routes.docs.no_responses') }}
        </p>
        <ul v-else class="divide-default divide-y">
          <li
            v-for="response in responses"
            :key="response.status"
            class="flex items-start gap-3 px-4 py-2.5"
          >
            <ApiStatusBadge
              :status="response.status"
              size="sm"
              class="mt-0.5"
            />
            <span class="flex min-w-0 flex-col">
              <span class="text-highlighted text-sm">{{ response.label }}</span>
              <span class="text-dimmed font-mono text-[11px]">
                {{ response.detail }}
              </span>
            </span>
          </li>
        </ul>
      </DmsCard>

      <DmsCard :title="t('api.routes.docs.pipeline')" :padded="false">
        <p class="text-dimmed px-4 pt-3 text-xs">
          {{ t('api.routes.docs.pipeline_description') }}
        </p>
        <ol class="flex flex-col gap-0 px-4 py-3">
          <li
            v-for="(step, index) in route.pipeline"
            :key="`${step.kind}-${step.name}-${index}`"
            class="flex items-center gap-3 py-1.5"
          >
            <span class="text-dimmed w-5 text-right font-mono text-[11px]">
              {{ index + 1 }}
            </span>
            <span class="min-w-0 grow">
              <span
                class="text-highlighted block truncate font-mono text-[12.5px]"
                :class="step.kind === 'handler' && 'text-primary font-semibold'"
              >
                {{ step.name }}
              </span>
              <span class="text-dimmed font-mono text-[11px]">
                {{ t(`api.routes.docs.kind_${step.kind}`) }} ·
                {{ step.location }}
              </span>
            </span>
            <DmsStatusPill
              v-if="step.isAuth"
              tone="info"
              size="sm"
              dot="none"
              icon="i-ph-lock-simple"
              :label="t('api.routes.docs.auth')"
            />
            <DmsStatusPill
              :tone="PIPELINE_TONE[step.kind]"
              size="sm"
              dot="none"
              :label="t(`api.routes.docs.kind_${step.kind}`)"
            />
          </li>
        </ol>
      </DmsCard>

      <details class="dms-card group overflow-hidden rounded-lg">
        <summary
          class="text-muted hover:text-default flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm"
        >
          <UIcon
            name="i-ph-caret-right"
            class="size-3.5 transition-transform group-open:rotate-90"
          />
          {{
            t('api.routes.docs.internals', {
              parameters: route.inspection.parameters.length,
              properties: route.inspection.properties.length,
            })
          }}
        </summary>
        <div class="border-default overflow-x-auto border-t">
          <table class="w-full text-[12px]">
            <thead class="text-dimmed font-mono text-[10.5px] uppercase">
              <tr>
                <th class="px-4 py-2 text-left font-medium">#</th>
                <th class="px-2 py-2 text-left font-medium">
                  {{ t('api.routes.docs.internal_name') }}
                </th>
                <th class="px-2 py-2 text-left font-medium">
                  {{ t('api.routes.docs.internal_source') }}
                </th>
                <th class="px-2 py-2 text-left font-medium">
                  {{ t('api.routes.docs.internal_type') }}
                </th>
                <th class="px-4 py-2 text-right font-medium">
                  {{ t('api.routes.docs.internal_modifiers') }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-default divide-y font-mono">
              <tr
                v-for="parameter in route.inspection.parameters"
                :key="`p-${parameter.index}`"
              >
                <td class="text-dimmed px-4 py-1.5">{{ parameter.index }}</td>
                <td class="px-2 py-1.5">{{ parameter.name ?? '—' }}</td>
                <td class="text-muted px-2 py-1.5">
                  {{ parameter.hint ?? parameter.source }}
                </td>
                <td class="text-muted px-2 py-1.5">
                  {{ parameter.inferredType }}
                </td>
                <td class="text-muted px-4 py-1.5 text-right">
                  {{ parameter.modifierCount }}
                </td>
              </tr>
              <tr
                v-for="property in route.inspection.properties"
                :key="`m-${property.key}`"
              >
                <td class="text-dimmed px-4 py-1.5">—</td>
                <td class="px-2 py-1.5">{{ property.key }}</td>
                <td class="text-muted px-2 py-1.5">{{ property.decorator }}</td>
                <td class="text-muted px-2 py-1.5">
                  {{ t('api.routes.docs.class_member') }}
                </td>
                <td class="text-muted px-4 py-1.5 text-right">
                  {{ property.modifierCount }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      <p class="text-dimmed text-xs">{{ t('api.routes.docs.prose_note') }}</p>
    </div>
  </div>
</template>
