<script setup lang="ts">
import { computed } from 'vue'
import type {
  MiddlewareInfo,
  ParameterInfo,
  PropertyInfo,
} from '../composables/useApiIntrospection'

const props = defineProps<{
  parameters?: ParameterInfo[]
  properties?: PropertyInfo[]
  middleware: MiddlewareInfo[]
}>()

const displayProperties = computed<PropertyInfo[]>(() => props.properties ?? [])

function priorityLabel(p?: number): string {
  if (p === undefined) return ''
  return ['HIGHEST', 'HIGH', 'NORMAL', 'LOW', 'LOWEST'][p] ?? String(p)
}
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <!-- Parameters -->
    <section class="flex flex-col gap-2">
      <h3 class="text-base font-semibold text-highlighted">
        {{ $t('page.api.routes.config.parameters') }}
      </h3>
      <p class="text-sm text-muted">
        {{ $t('page.api.routes.config.parameters_description') }}
      </p>

      <div
        v-if="!parameters || parameters.length === 0"
        class="flex flex-col items-center gap-2 rounded border border-dashed border-default p-4 text-center"
      >
        <UIcon name="i-ph-list-dashes" class="text-2xl text-muted" />
        <p class="text-sm font-medium text-highlighted">
          {{ $t('page.api.routes.config.no_parameters_title') }}
        </p>
        <p class="text-xs text-muted">
          {{ $t('page.api.routes.config.no_parameters_description') }}
        </p>
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="p in parameters"
          :key="p.index"
          class="rounded border border-default bg-elevated/40 p-3"
        >
          <div class="flex flex-wrap items-center gap-2">
            <UBadge color="primary" variant="subtle">#{{ p.index }}</UBadge>
            <UBadge color="neutral" variant="outline">{{ p.source }}</UBadge>
            <UBadge color="info" variant="subtle" size="xs">{{ p.inferredType }}</UBadge>
            <UBadge v-if="p.multi" color="warning" variant="subtle" size="xs">multi</UBadge>
            <code class="font-mono text-sm">
              {{ p.name ?? $t('page.api.routes.doc.unnamed') }}
            </code>
            <UBadge v-if="p.hint" color="neutral" variant="subtle" size="xs" class="font-mono">
              {{ p.hint }}
            </UBadge>
            <span class="ml-auto text-xs text-dimmed">
              {{ p.modifierCount }} {{ $t('page.api.routes.config.modifiers') }}
            </span>
          </div>
          <details v-if="p.rawProviderSource" class="mt-2 text-xs">
            <summary class="cursor-pointer text-dimmed">
              {{ $t('page.api.routes.doc.show_source') }}
            </summary>
            <pre class="mt-1 max-h-32 overflow-auto rounded bg-default p-2 text-[10px]">{{ p.rawProviderSource }}</pre>
          </details>
        </div>
      </div>
    </section>

    <!-- Class-member properties / "middleware" per spec -->
    <section class="flex flex-col gap-2">
      <h3 class="text-base font-semibold text-highlighted">
        {{ $t('page.api.routes.config.properties') }}
      </h3>
      <p class="text-sm text-muted">
        {{ $t('page.api.routes.config.properties_description') }}
      </p>

      <div
        v-if="displayProperties.length === 0"
        class="flex flex-col items-center gap-2 rounded border border-dashed border-default p-4 text-center"
      >
        <UIcon name="i-ph-cube" class="text-2xl text-muted" />
        <p class="text-sm font-medium text-highlighted">
          {{ $t('page.api.routes.config.no_properties_title') }}
        </p>
        <p class="text-xs text-muted">
          {{ $t('page.api.routes.config.no_properties_description') }}
        </p>
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="prop in displayProperties"
          :key="prop.key"
          class="rounded border border-default bg-elevated/40 p-3"
        >
          <div class="flex flex-wrap items-center gap-2">
            <UBadge color="info" variant="subtle">{{ prop.decorator }}</UBadge>
            <code class="font-mono text-sm">{{ prop.key }}</code>
            <UBadge
              v-if="prop.hint"
              color="neutral"
              variant="subtle"
              size="xs"
              class="font-mono"
            >
              {{ prop.hint }}
            </UBadge>
            <span class="ml-auto text-xs text-dimmed">
              {{ prop.modifierCount }} {{ $t('page.api.routes.config.modifiers') }}
            </span>
          </div>
          <details v-if="prop.rawProviderSource" class="mt-2 text-xs">
            <summary class="cursor-pointer text-dimmed">
              {{ $t('page.api.routes.doc.show_source') }}
            </summary>
            <pre class="mt-1 max-h-32 overflow-auto rounded bg-default p-2 text-[10px]">{{ prop.rawProviderSource }}</pre>
          </details>
        </div>
      </div>
    </section>

    <!-- Applicable middleware -->
    <section class="flex flex-col gap-2">
      <h3 class="text-base font-semibold text-highlighted">
        {{ $t('page.api.routes.config.middleware') }}
      </h3>
      <p class="text-sm text-muted">
        {{ $t('page.api.routes.config.middleware_route_description') }}
      </p>

      <div
        v-if="middleware.length === 0"
        class="flex flex-col items-center gap-2 rounded border border-dashed border-default p-4 text-center"
      >
        <UIcon name="i-ph-stack" class="text-2xl text-muted" />
        <p class="text-sm font-medium text-highlighted">
          {{ $t('page.api.routes.config.no_middleware_title') }}
        </p>
        <p class="text-xs text-muted">
          {{ $t('page.api.routes.config.no_middleware_description') }}
        </p>
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="m in middleware"
          :key="m.id"
          class="rounded border border-default bg-elevated/40 p-3"
        >
          <div class="flex flex-wrap items-center gap-2">
            <UBadge
              :color="m.mode === 'prefix' ? 'success' : m.mode === 'postfix' ? 'warning' : 'info'"
              variant="subtle"
            >
              {{ m.mode }}
            </UBadge>
            <UBadge v-if="m.isAuth" color="warning" variant="subtle" size="xs">
              {{ $t('page.api.routes.config.auth_badge') }}
            </UBadge>
            <code class="font-mono text-sm">{{ m.callbackName }}</code>
            <code class="font-mono text-xs text-muted">{{ m.location }}</code>
            <UBadge color="neutral" variant="outline" size="xs">{{ m.method }}</UBadge>
            <UBadge
              v-if="m.priority !== undefined"
              color="neutral"
              variant="subtle"
              size="xs"
              class="ml-auto"
            >
              {{ priorityLabel(m.priority) }}
            </UBadge>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
