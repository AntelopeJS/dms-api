<script setup lang="ts">
import { hasRedacted } from '../../utils/testerRequest'
import type { TesterContext } from './routeTester/context'

// The tester's request card: the body, the query, the headers and the auth, by tab.
const props = defineProps<{ tester: TesterContext }>()

const {
  body,
  bodyAllowed,
  bodyHint,
  bodyHintId,
  bodyMode,
  bodyModeItems,
  editBody,
  editors,
  formatBody,
  formattedBody,
  jsonWarning,
  modified,
  queryHint,
  redactedBodyFields,
  resetToExample,
  row,
  shownImpliedHeaders,
  t,
  tab,
  tabs,
} = props.tester
</script>

<template>
  <DmsCard :padded="false" class="@container min-w-0">
    <div
      class="border-default flex flex-wrap items-center gap-x-2 border-b px-3"
    >
      <!-- overflow-x-auto alone turns overflow-y to auto: the active
               tab's underline would show a scrollbar. -->
      <UTabs
        v-model="tab"
        :items="tabs"
        :content="false"
        variant="link"
        size="sm"
        class="min-w-0 grow overflow-x-auto overflow-y-hidden"
      />
      <template v-if="modified">
        <span class="text-dimmed inline-flex items-center gap-1.5 text-xs">
          <span class="bg-warning size-1.5 rounded-full" aria-hidden="true" />
          {{ t('api.tester.draft_modified') }}
        </span>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-ph-arrow-counter-clockwise"
          :label="t('api.tester.reset')"
          @click="resetToExample()"
        />
      </template>
    </div>
    <div class="p-3">
      <div
        v-if="tab === 'body' && bodyAllowed"
        class="mb-2 flex flex-wrap items-center gap-2"
      >
        <USelect
          v-model="bodyMode"
          :items="bodyModeItems"
          size="xs"
          class="w-36"
          :aria-label="t('api.tester.body_mode')"
        />
        <span class="grow" />
        <UButton
          v-if="bodyMode === 'json'"
          size="xs"
          color="neutral"
          variant="outline"
          icon="i-ph-brackets-curly"
          :disabled="formattedBody === null || formattedBody === body"
          :label="t('api.tester.format')"
          @click="formatBody"
        />
      </div>

      <template
        v-if="
          tab === 'body' &&
          bodyAllowed &&
          (bodyMode === 'json' || bodyMode === 'text')
        "
      >
        <DmsInputCode
          :key="bodyMode"
          :model-value="body"
          :language="bodyMode === 'json' ? 'json' : 'text'"
          :min-lines="12"
          :max-lines="24"
          :aria-describedby="bodyHintId"
          @update:model-value="editBody"
        />
      </template>

      <div
        v-else-if="tab !== 'body' || (bodyAllowed && bodyMode === 'form')"
        class="flex flex-col gap-4"
      >
        <div
          v-if="tab === 'headers' && shownImpliedHeaders.length"
          class="text-dimmed flex flex-col gap-1 font-mono text-xs"
        >
          <span v-for="[name, value] in shownImpliedHeaders" :key="name">
            {{ name }}: {{ value }}
            <span class="font-sans">
              · {{ t('api.tester.implied_header') }}
            </span>
          </span>
        </div>
        <div
          v-for="editor in editors"
          :key="editor.key"
          class="@sm:gap-2 flex flex-col gap-3"
        >
          <p
            v-if="editor.title"
            class="text-default border-default border-t pt-3 text-xs font-medium"
          >
            {{ editor.title }}
          </p>
          <!-- In a narrow card the name takes a line of its own, the
                   value and its button the next: a name is never cut. -->
          <div
            v-for="(entry, index) in editor.list"
            :key="entry.id"
            class="@sm:flex-nowrap flex flex-wrap gap-2"
          >
            <UInput
              v-model="entry.name"
              size="sm"
              class="@sm:w-2/5 w-full font-mono"
              :placeholder="t('dms.form.key_value.key')"
              :aria-label="t('dms.form.key_value.key')"
            />
            <UInput
              v-model="entry.value"
              size="sm"
              class="min-w-0 flex-1 font-mono"
              :placeholder="t('dms.form.key_value.value')"
              :aria-label="t('dms.form.key_value.value')"
              :color="hasRedacted(entry.value) ? 'warning' : undefined"
              :highlight="hasRedacted(entry.value)"
              :title="
                hasRedacted(entry.value)
                  ? t('api.tester.redacted_value')
                  : undefined
              "
            />
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-ph-x"
              :aria-label="t('api.tester.remove')"
              @click="editor.list.splice(index, 1)"
            />
          </div>
          <div>
            <UButton
              size="xs"
              color="neutral"
              variant="outline"
              icon="i-ph-plus"
              :label="editor.add"
              @click="editor.list.push(row())"
            />
          </div>
          <p v-if="editor.hint" class="text-dimmed text-xs">
            {{ editor.hint }}
          </p>
          <p
            v-if="editor.warning"
            class="text-warning inline-flex items-start gap-1 text-xs"
          >
            <UIcon name="i-ph-key" class="mt-px size-3.5 shrink-0" />
            {{ editor.warning }}
          </p>
        </div>
        <p v-if="tab !== 'body'" class="text-dimmed text-xs">
          <template v-if="tab === 'headers'">
            {{ t('api.tester.headers_hint') }}
            {{ t('api.tester.marks_hint') }}
          </template>
          <template v-else-if="tab === 'query'">{{ queryHint }}</template>
        </p>
      </div>

      <template v-if="tab === 'body' && bodyAllowed">
        <p v-if="jsonWarning" class="text-warning mt-1.5 text-xs">
          {{ t('api.tester.json_warning', { message: jsonWarning }) }}
        </p>
        <p v-if="redactedBodyFields.length" class="text-warning mt-1.5 text-xs">
          {{
            t(
              'api.tester.body_redacted',
              {
                count: redactedBodyFields.length,
                names: redactedBodyFields.join(', '),
              },
              redactedBodyFields.length,
            )
          }}
        </p>
        <p
          v-if="bodyHint.text"
          :id="bodyHintId"
          class="mt-1.5 text-xs"
          :class="bodyHint.tone === 'warning' ? 'text-warning' : 'text-dimmed'"
        >
          {{ bodyHint.text }}
        </p>
      </template>
    </div>
  </DmsCard>
</template>
