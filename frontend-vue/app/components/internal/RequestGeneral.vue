<script setup lang="ts">
// What the request was: its URL, date, route and where it came from.
defineProps<{
  general: { key: string; label: string; value: string; copy?: boolean }[]
  isTester: boolean
}>()

const { t } = useI18n()
</script>

<template>
  <section class="flex flex-col gap-2">
    <DmsEyebrow :label="t('api.request.general')" />
    <dl
      class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12.5px]"
    >
      <template v-for="row in general" :key="row.key">
        <dt class="text-muted">{{ row.label }}</dt>
        <dd class="text-default flex min-w-0 items-start gap-1">
          <bdi class="min-w-0 font-mono text-[12px] [overflow-wrap:anywhere]">
            {{ row.value }}
          </bdi>
          <DmsCopyButton v-if="row.copy" :value="row.value" class="-my-1.5" />
        </dd>
      </template>
      <template v-if="isTester">
        <dt class="text-muted">{{ t('api.request.fields.source') }}</dt>
        <dd class="text-default">{{ t('api.request.source_tester') }}</dd>
      </template>
    </dl>
  </section>
</template>
