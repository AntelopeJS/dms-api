<script setup lang="ts">
import { computed } from 'vue'
import { toCurl } from '../../utils/snippets'
import { hasRequestBody } from '../../utils/http'
import ApiMethodBadge from '../internal/ApiMethodBadge.vue'
import ApiPath from '../internal/ApiPath.vue'

// The selected route, above its tabs: what it is, who may call it, where it
// comes from, and the two ways out — its requests and a cURL to replay it.
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{ fetchUrl: string; queryKey?: string }>(),
  {
    queryKey: 'route',
  },
)

const STATE_TONE = {
  failing: 'error',
  slow: 'warning',
  'client-errors': 'warning',
  healthy: 'success',
  idle: 'neutral',
} as const

const { t } = useI18n()
const apiOrigin = useApiOrigin()
const toast = useToast()
const {
  data: route,
  pending,
  missing,
  selection,
  refresh,
  error,
} = useRouteDetail(props.fetchUrl, props.queryKey)

const requestsLink = computed(() =>
  route.value
    ? `/modules/api/logs?${new URLSearchParams({ route: route.value.ref })}`
    : '',
)

const source = computed(() => {
  if (!route.value) return ''
  if (route.value.own) return t('api.routes.header.own')
  return route.value.module
    ? t('api.routes.header.module', { module: route.value.module })
    : t('api.routes.header.unknown_source')
})

async function copyCurl() {
  if (!route.value) return
  const body = route.value.contract.exampleBody
  const curl = toCurl({
    method: route.value.method,
    url: `${apiOrigin.value}${route.value.path}`,
    headers: hasRequestBody(route.value.method)
      ? { 'content-type': 'application/json' }
      : {},
    body:
      hasRequestBody(route.value.method) && body
        ? JSON.stringify(body)
        : undefined,
  })
  try {
    await navigator.clipboard.writeText(curl)
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
</script>

<template>
  <DmsCard v-if="!selection.ref.value" :padded="false" class="px-5 py-8">
    <DmsEmptyState
      icon="i-ph-tree-structure"
      :title="t('api.routes.header.pick_title')"
      :description="t('api.routes.header.pick_description')"
    />
  </DmsCard>

  <DmsCard v-else-if="pending" :padded="false" class="px-5 py-4">
    <USkeleton class="h-3 w-40" />
    <USkeleton class="mt-3 h-7 w-72" />
    <USkeleton class="mt-3 h-3 w-96" />
  </DmsCard>

  <DmsCard v-else-if="!route" :padded="false" class="px-5 py-6">
    <DmsEmptyState
      :variant="missing ? 'no-result' : 'error'"
      :title="
        missing
          ? t('api.routes.header.missing_title', { route: selection.ref.value })
          : t('api.routes.header.error_title')
      "
      :description="
        missing
          ? t('api.routes.header.missing_description')
          : String((error as Error)?.message ?? '')
      "
      :actions="
        missing
          ? [
              {
                label: t('api.routes.header.clear'),
                color: 'neutral',
                variant: 'outline',
                onClick: () => selection.select(null),
              },
            ]
          : [{ label: t('api.common.retry'), onClick: () => refresh() }]
      "
    />
  </DmsCard>

  <DmsCard v-else :padded="false" class="px-5 py-4">
    <p class="text-dimmed flex items-center gap-1.5 font-mono text-[11.5px]">
      <UIcon name="i-ph-folder-simple" class="size-3.5" />
      {{ route.folder }}
      <template v-if="route.controller">· {{ route.controller }}</template>
    </p>
    <div class="mt-2 flex flex-wrap items-center gap-3">
      <ApiMethodBadge :method="route.method" />
      <ApiPath
        :path="route.path"
        class="text-highlighted text-xl font-semibold tracking-tight"
      />
      <DmsCopyButton :value="route.path" />
      <span class="grow" />
      <UButton
        :to="requestsLink"
        size="sm"
        color="neutral"
        variant="outline"
        icon="i-ph-list-magnifying-glass"
        :label="t('api.routes.header.requests')"
      />
      <UButton
        size="sm"
        color="neutral"
        variant="outline"
        icon="i-ph-terminal"
        :label="t('api.request.copy_curl')"
        @click="copyCurl"
      />
    </div>
    <div
      class="text-muted mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px]"
    >
      <DmsStatusPill
        :tone="STATE_TONE[route.state]"
        :label="t(`api.routes.state.${route.state.replace('-', '_')}`)"
        :dot="route.state === 'idle' ? 'static' : 'live'"
        :mono="false"
        variant="text"
      />
      <span class="inline-flex items-center gap-1.5 font-mono text-[12px]">
        <UIcon name="i-ph-code" class="size-3.5" />
        {{
          route.controller
            ? `${route.controller}.${route.handler}`
            : route.handler
        }}
      </span>
      <span class="inline-flex items-center gap-1.5">
        <UIcon
          :name="route.requiresAuth ? 'i-ph-lock-simple' : 'i-ph-globe-simple'"
          class="size-3.5"
        />
        {{
          route.requiresAuth
            ? t('api.routes.header.auth')
            : t('api.routes.header.public')
        }}
      </span>
      <span class="inline-flex items-center gap-1.5">
        <UIcon name="i-ph-cube" class="size-3.5" />
        {{ source }}
      </span>
    </div>
  </DmsCard>
</template>
