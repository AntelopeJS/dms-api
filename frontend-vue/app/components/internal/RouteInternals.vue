<script setup lang="ts">
import { computed } from 'vue'
import type { RouteDetail } from '../../composables/useRouteDetail'

// The documentation's last column: the pipeline a request meets, then the
// controller's internals, folded.
const props = defineProps<{ route: RouteDetail }>()

const { t } = useI18n()

// Internals worth a row: a parameter the introspection could name or place,
// a class member. An unnamed `unknown` row says nothing.
const internalParameters = computed(() =>
  (props.route.inspection.parameters ?? []).filter(
    (parameter) => parameter.name || parameter.source !== 'unknown',
  ),
)
const internalProperties = computed(
  () => props.route.inspection.properties ?? [],
)

const PIPELINE_TONE = {
  prefix: 'info',
  handler: 'primary',
  postfix: 'neutral',
  monitor: 'neutral',
} as const
</script>

<template>
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

  <details
    v-if="internalParameters.length || internalProperties.length"
    class="dms-card group overflow-hidden rounded-lg"
  >
    <summary
      class="text-muted hover:text-default flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm"
    >
      <UIcon
        name="i-ph-caret-right"
        class="size-3.5 transition-transform group-open:rotate-90"
      />
      {{ t('api.routes.docs.internals') }}
      <span class="text-dimmed text-xs">
        ·
        {{
          t(
            'api.routes.docs.internals_parameters',
            { count: internalParameters.length },
            internalParameters.length,
          )
        }},
        {{
          t(
            'api.routes.docs.internals_members',
            { count: internalProperties.length },
            internalProperties.length,
          )
        }}
      </span>
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
            v-for="parameter in internalParameters"
            :key="`p-${parameter.index}`"
          >
            <td class="text-dimmed px-4 py-1.5">{{ parameter.index }}</td>
            <td class="px-2 py-1.5">
              {{ parameter.name ?? parameter.decorator ?? '—' }}
            </td>
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
          <tr v-for="property in internalProperties" :key="`m-${property.key}`">
            <td class="text-dimmed px-4 py-1.5">—</td>
            <td class="px-2 py-1.5">{{ property.key }}</td>
            <td class="text-muted px-2 py-1.5">
              {{ property.decorator }}
            </td>
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
</template>
