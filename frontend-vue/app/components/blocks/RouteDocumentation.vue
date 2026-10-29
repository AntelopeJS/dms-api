<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatCount, formatMs, formatRelativeDay } from '../../utils/format'
import { hasRequestBody, statusText } from '../../utils/http'
import { listedMessages } from '../../utils/routeExplorer'
import { routeSnippetRequest, toCurl, toFetch } from '../../utils/snippets'
import ApiStatusBadge from '../internal/ApiStatusBadge.vue'
import RouteInternals from '../internal/RouteInternals.vue'

// The contract of a route, read first: how to call it, who may, what it
// expects and what it answers. Everything is inferred, and the block says so:
// statuses, fields and examples from the last days of captured requests (the
// tester's left out), guards and error codes from the handler's code. The
// controller's internals stay folded at the end.
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
  /** The messages the status came with, most frequent first, each counted. */
  messages: Array<{ message: string; count: number }>
  /** Distinct messages left out of `messages`. */
  moreMessages: number
}

/** Messages listed under a status; the others are counted. */
const LISTED_MESSAGES = 5

const { t } = useI18n()
const { formatLocale: locale } = useRegionalFormat({ locale: 'format' })
const dateFormat = useDateFormat()
const currentRoute = useDmsRoute()
const router = useDmsRouter()
const {
  data: route,
  pending,
  selection,
} = useRouteDetail(props.fetchUrl, props.queryKey)
const apiOrigin = useApiOrigin(() => route.value?.apiOrigin)

const snippetKind = ref<SnippetKind>('curl')
const snippetItems = [
  { label: 'cURL', value: 'curl' },
  { label: 'fetch', value: 'fetch' },
]

const withBody = computed(() => hasRequestBody(route.value?.method))
const days = computed(() => route.value?.contract.windowDays ?? 7)

const snippet = computed(() => {
  const value = route.value
  if (!value) return ''
  const request = routeSnippetRequest(value, apiOrigin.value, withBody.value)
  return snippetKind.value === 'curl' ? toCurl(request) : toFetch(request)
})

const auth = computed(() => {
  const value = route.value?.auth
  if (!value) return null
  if (value.status === 'required') {
    return {
      tone: 'info' as const,
      icon: 'i-ph-lock-simple',
      title: t('api.routes.docs.auth_title'),
      description: t('api.routes.docs.auth_description', {
        guards: value.guards.join(', '),
      }),
    }
  }
  if (value.status === 'probable') {
    return {
      tone: 'info' as const,
      icon: 'i-ph-shield-warning',
      title: t('api.routes.docs.probable_title'),
      description: t(
        'api.routes.docs.probable_description',
        {
          count: formatCount(value.unauthorized, locale.value),
          days: days.value,
        },
        value.unauthorized,
      ),
    }
  }
  return null
})

const parameterGroups = computed(() => {
  const parameters = route.value?.parameters ?? []
  return (['path', 'query', 'header'] as const)
    .map((where) => ({
      where,
      parameters: parameters.filter((parameter) => parameter.in === where),
    }))
    .filter((group) => group.parameters.length > 0)
})

const responses = computed<ResponseRow[]>(() => {
  const value = route.value
  if (!value) return []
  const rows = new Map<number, ResponseRow>()
  for (const observed of value.contract.statuses) {
    const seen = t(
      'api.routes.docs.observed',
      {
        count: formatCount(observed.count, locale.value),
        days: days.value,
      },
      observed.count,
    )
    const last = t('api.routes.docs.last_seen', {
      time: formatRelativeDay(observed.lastSeen, dateFormat.value),
    })
    const { messages, more } = listedMessages(observed, LISTED_MESSAGES)
    rows.set(observed.status, {
      status: observed.status,
      label: statusText(observed.status) || String(observed.status),
      detail: `${seen} · ${last}`,
      messages,
      moreMessages: more,
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
      messages: existing?.messages ?? [],
      moreMessages: existing?.moreMessages ?? 0,
    })
  }
  return [...rows.values()].sort((a, b) => a.status - b.status)
})

const latency = computed(() => {
  const value = route.value?.contract.latency
  if (!value) return ''
  return t('api.routes.docs.latency', {
    p50: formatMs(value.p50, locale.value),
    p95: formatMs(value.p95, locale.value),
  })
})

const exampleResponse = computed(() => route.value?.contract.exampleResponse)

function openTester() {
  void router.push({ query: { ...currentRoute.query, tab: '2' } })
}

function exampleOf(value: string | number | boolean | null | undefined) {
  return value === undefined ? '' : JSON.stringify(value)
}
</script>

<template>
  <div v-if="!selection.ref.value" />
  <div v-else-if="pending" class="flex flex-col gap-4">
    <USkeleton class="h-40" />
    <USkeleton class="h-56" />
  </div>
  <div v-else-if="route" class="flex flex-col gap-4">
    <DmsBanner
      tone="primary"
      size="sm"
      icon="i-ph-flask"
      :title="t('api.routes.docs.beta_title')"
      :description="t('api.routes.docs.beta_description', { days })"
    />

    <div class="grid gap-4 2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
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
          <DmsCodeSnippet :code="snippet" max-height="20rem" wrap="anywhere" />
          <p v-if="!apiOrigin" class="text-warning mt-2 text-xs">
            {{ t('api.routes.docs.origin_unknown') }}
          </p>
        </DmsCard>

        <DmsBanner
          v-if="auth"
          :tone="auth.tone"
          size="sm"
          :icon="auth.icon"
          :title="auth.title"
          :description="auth.description"
        />
        <div
          v-else
          class="border-default text-muted flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm"
        >
          <UIcon
            name="i-ph-question"
            class="text-dimmed mt-0.5 size-4 shrink-0"
          />
          <span>
            <span class="text-default font-medium">
              {{ t('api.routes.docs.unknown_title') }}
            </span>
            · {{ t('api.routes.docs.unknown_description') }}
          </span>
        </div>

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
                  { count: formatCount(route.contract.sampled, locale) },
                  route.contract.sampled,
                )
              "
            />
          </template>
          <p
            v-if="route.contract.bodyFields.length === 0"
            class="text-dimmed text-sm"
          >
            {{ t('api.routes.docs.no_body', { days }) }}
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
              <span
                v-if="field.example !== undefined"
                class="text-dimmed max-w-[14rem] truncate font-mono text-[12px]"
                :title="exampleOf(field.example)"
              >
                {{
                  t('api.routes.docs.example_value', {
                    value: exampleOf(field.example),
                  })
                }}
              </span>
              <span class="text-muted font-mono text-[12px]">
                {{ field.types.join(' | ') }}
              </span>
            </li>
          </ul>
        </DmsCard>

        <DmsCard :title="t('api.routes.docs.parameters')">
          <p v-if="parameterGroups.length === 0" class="text-dimmed text-sm">
            {{ t('api.routes.docs.no_parameters') }}
          </p>
          <dl v-else class="grid gap-3 text-sm">
            <div v-for="group in parameterGroups" :key="group.where">
              <dt
                class="text-dimmed font-mono text-[10.5px] uppercase tracking-[0.08em]"
              >
                {{ t(`api.routes.docs.in_${group.where}`) }}
              </dt>
              <dd class="divide-default mt-1 divide-y">
                <div
                  v-for="parameter in group.parameters"
                  :key="parameter.name"
                  class="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5"
                >
                  <code
                    class="bg-elevated rounded px-1.5 py-0.5 font-mono text-[12px]"
                    :class="group.where === 'path' && 'text-primary'"
                  >
                    {{
                      group.where === 'path'
                        ? `:${parameter.name}`
                        : parameter.name
                    }}
                  </code>
                  <span class="text-muted font-mono text-[12px]">
                    {{ parameter.type }}
                  </span>
                  <DmsStatusPill
                    v-if="parameter.required"
                    tone="warning"
                    dot="none"
                    size="sm"
                    :label="t('api.routes.docs.required')"
                  />
                  <span
                    v-if="!parameter.declared"
                    class="text-dimmed text-[11px]"
                  >
                    {{ t('api.routes.docs.seen_only') }}
                  </span>
                  <span class="grow" />
                  <span
                    class="text-dimmed max-w-[16rem] truncate font-mono text-[12px]"
                    :title="parameter.example ?? undefined"
                  >
                    {{
                      parameter.example
                        ? t('api.routes.docs.example_value', {
                            value: parameter.example,
                          })
                        : t('api.routes.docs.no_example')
                    }}
                  </span>
                </div>
              </dd>
            </div>
          </dl>
        </DmsCard>
      </div>

      <div class="flex min-w-0 flex-col gap-4">
        <DmsCard :title="t('api.routes.docs.responses')" :padded="false">
          <template v-if="latency" #actions>
            <DmsStatusPill
              tone="neutral"
              dot="none"
              size="sm"
              :label="latency"
            />
          </template>
          <p
            v-if="responses.length === 0"
            class="text-dimmed px-4 py-4 text-sm"
          >
            {{ t('api.routes.docs.no_responses', { days }) }}
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
                <span class="text-highlighted text-sm">
                  {{ response.label }}
                </span>
                <span class="text-dimmed font-mono text-[11px]">
                  {{ response.detail }}
                </span>
                <span
                  v-for="other in response.messages"
                  :key="other.message"
                  class="text-muted truncate text-xs"
                  :title="other.message"
                >
                  {{ other.message }}
                  <span class="text-dimmed font-mono text-[11px]">
                    × {{ formatCount(other.count, locale) }}
                  </span>
                </span>
                <span
                  v-if="response.moreMessages > 0"
                  class="text-dimmed font-mono text-[11px]"
                >
                  {{
                    t(
                      'api.routes.docs.more_messages',
                      { count: formatCount(response.moreMessages, locale) },
                      response.moreMessages,
                    )
                  }}
                </span>
              </span>
            </li>
          </ul>
        </DmsCard>

        <DmsCard
          v-if="exampleResponse || route.contract.responseFields.length"
          :title="t('api.routes.docs.response')"
        >
          <ul
            v-if="route.contract.responseFields.length"
            class="divide-default mb-3 divide-y"
          >
            <li
              v-for="field in route.contract.responseFields"
              :key="field.name"
              class="flex items-center gap-3 py-1.5"
            >
              <span class="text-highlighted font-mono text-[12.5px]">
                {{
                  route.contract.responseKind === 'array'
                    ? `[].${field.name}`
                    : field.name
                }}
              </span>
              <span class="grow" />
              <span class="text-muted font-mono text-[12px]">
                {{ field.types.join(' | ') }}
              </span>
            </li>
          </ul>
          <DmsCodeSnippet
            v-if="exampleResponse"
            :code="exampleResponse.body"
            :title="
              t('api.routes.docs.example_response', {
                status: exampleResponse.status,
              })
            "
            max-height="16rem"
            wrap="anywhere"
          />
          <p v-if="exampleResponse?.truncated" class="text-dimmed mt-2 text-xs">
            {{ t('api.routes.docs.response_truncated') }}
          </p>
        </DmsCard>

        <RouteInternals :route="route" />
      </div>
    </div>
  </div>
</template>
