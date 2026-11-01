<script setup lang="ts">
import { formatBytes, formatClock, formatMs } from '../../utils/format'
import { hasRedacted } from '../../utils/testerRequest'
import ApiMethodBadge from '../internal/ApiMethodBadge.vue'
import ApiStatusBadge from '../internal/ApiStatusBadge.vue'
import RouteTesterRequest from '../internal/RouteTesterRequest.vue'
import RouteTesterResponse from '../internal/RouteTesterResponse.vue'
import type { TesterContext } from '../internal/routeTester/context'
import { useTesterExtras } from '../internal/routeTester/useTesterExtras'
import { useTesterFlow } from '../internal/routeTester/useTesterFlow'
import {
  type RouteTesterProps,
  useTesterState,
} from '../internal/routeTester/useTesterState'

// Call the selected route from the dashboard. The URL bar holds the method,
// the path with its parameters to fill in, and Send; the body starts from
// the last request the route accepted. A route keeps its draft for the
// session (body, headers, query, path values, last answer), across tabs,
// routes and pages. A call that writes data is confirmed first, and the
// answer shows its status, the browser and server times and what the module
// captured of it (`x-request-id`). `?replay=<request id>` loads a captured
// request once, then leaves the URL.
//
// Typing in one of its fields holds the page's live mode ("Paused · typing in
// the Tester"), so the route's figures do not move under the request being
// written; leaving the Tester releases it.

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<RouteTesterProps>(), {
  queryKey: 'route',
})

const state = useTesterState(props)
const flow = useTesterFlow(state)
const tester: TesterContext = {
  ...state,
  ...flow,
  ...useTesterExtras({ ...state, ...flow }),
}
const {
  AUTH_ICONS,
  auth,
  authLabel,
  blocker,
  blockerId,
  cancel,
  clearHistory,
  copyCurl,
  dateFormat,
  displayQuery,
  filledRef,
  history,
  liveMessage,
  locale,
  loggedIn,
  onFocusIn,
  onFocusOut,
  onKey,
  path,
  pathValues,
  pending,
  readable,
  recordLink,
  replayDescription,
  replayInfo,
  replayTitle,
  restore,
  route,
  segments,
  selection,
  send,
  sending,
  shortcut,
  t,
  useSession,
  writes,
} = tester
</script>

<template>
  <div v-if="!selection.ref.value" />
  <USkeleton v-else-if="pending || (route && !filledRef)" class="h-72" />
  <div
    v-else-if="route"
    class="flex flex-col gap-4"
    @keydown.capture="onKey"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
  >
    <DmsCard :padded="false">
      <!-- The method and the path keep a line of their own when the card is
           narrow: the buttons go under them, and a long path wraps. -->
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <div class="flex min-w-0 grow basis-80 items-center gap-3">
          <ApiMethodBadge :method="route.method" solid class="shrink-0" />
          <div
            class="text-highlighted flex min-w-0 grow flex-wrap items-center gap-y-1 font-mono text-[13px]"
            :title="readable(path)"
          >
            <template v-for="(segment, index) in segments" :key="index">
              <input
                v-if="segment.param"
                v-model="pathValues[segment.name]"
                type="text"
                spellcheck="false"
                :placeholder="segment.text"
                :aria-label="t('api.tester.path_param', { name: segment.text })"
                :aria-invalid="!pathValues[segment.name]"
                :title="
                  hasRedacted(pathValues[segment.name])
                    ? t('api.tester.redacted_value')
                    : undefined
                "
                class="bg-elevated focus:ring-primary mx-0.5 min-w-[4ch] max-w-full rounded px-1 py-0.5 outline-none focus:ring-2"
                :class="
                  !pathValues[segment.name]
                    ? 'ring-error/60 placeholder:text-error/70 ring-1'
                    : hasRedacted(pathValues[segment.name])
                      ? 'ring-warning ring-1'
                      : ''
                "
                :style="{
                  width: `${Math.min(28, Math.max(segment.text.length, (pathValues[segment.name] ?? '').length) + 2)}ch`,
                }"
              />
              <span v-else class="min-w-0 break-all">{{ segment.text }}</span>
            </template>
            <span v-if="displayQuery" class="text-muted min-w-0 break-all">
              {{ displayQuery }}
            </span>
          </div>
        </div>
        <div class="ms-auto flex flex-wrap items-center justify-end gap-2">
          <UButton
            size="sm"
            color="neutral"
            variant="outline"
            icon="i-ph-terminal"
            :label="t('api.request.copy_curl')"
            @click="copyCurl"
          />
          <UButton
            v-if="sending"
            size="sm"
            color="neutral"
            variant="soft"
            icon="i-ph-x"
            :label="t('dms.confirm.cancel')"
            @click="cancel"
          />
          <UButton
            size="sm"
            icon="i-ph-paper-plane-tilt"
            :loading="sending"
            :disabled="!!blocker"
            :label="t('api.tester.send')"
            aria-keyshortcuts="Control+Enter Meta+Enter"
            :aria-describedby="blocker ? blockerId : undefined"
            @click="send"
          >
            <template #trailing>
              <span class="hidden gap-0.5 sm:flex" aria-hidden="true">
                <UKbd :value="shortcut" size="sm" />
                <UKbd value="↵" size="sm" />
              </span>
            </template>
          </UButton>
        </div>
      </div>
      <div
        class="border-default flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t px-4 py-2.5 text-[12.5px]"
      >
        <label class="flex cursor-pointer items-center gap-2">
          <USwitch v-model="useSession" size="sm" :disabled="!loggedIn" />
          <span class="text-default">{{ t('api.tester.session') }}</span>
        </label>
        <span
          class="inline-flex items-center gap-1"
          :class="auth === 'manual' ? 'text-warning' : 'text-dimmed'"
        >
          <UIcon :name="AUTH_ICONS[auth]" class="size-3.5 shrink-0" />
          {{ authLabel }}
        </span>
        <span class="grow" />
        <span
          v-if="blocker"
          :id="blockerId"
          class="text-error inline-flex items-center gap-1"
        >
          <UIcon name="i-ph-warning-circle" class="size-3.5 shrink-0" />
          {{ blocker }}
        </span>
        <!-- The trigger is a plain element: the DMS components load
             asynchronously, and a tooltip anchored on one still loading
             reads an element it does not have yet (a direct load of the
             tab crashed on it). -->
        <UTooltip v-if="writes" :text="t('api.tester.writes_hint')">
          <span class="inline-flex rounded-full" tabindex="0">
            <DmsStatusPill
              tone="warning"
              icon="i-ph-warning"
              :mono="false"
              :label="t('api.tester.writes')"
            />
          </span>
        </UTooltip>
      </div>
      <div v-if="replayInfo" class="border-default border-t px-4 py-2.5">
        <DmsBanner
          tone="info"
          size="sm"
          icon="i-ph-arrow-counter-clockwise"
          :title="replayTitle"
          :description="replayDescription"
          dismissible
          @dismiss="replayInfo = null"
        >
          <template #actions>
            <UButton
              :to="recordLink(replayInfo.id)"
              size="xs"
              color="neutral"
              variant="outline"
              :label="t('api.tester.replay_banner.open')"
            />
          </template>
        </DmsBanner>
      </div>
    </DmsCard>

    <div class="grid gap-4 xl:grid-cols-2 xl:items-start">
      <RouteTesterRequest :tester="tester" />

      <RouteTesterResponse :tester="tester" />
    </div>

    <DmsCard :title="t('api.tester.history')" :padded="false">
      <template #actions>
        <span class="text-dimmed text-xs">
          {{ t('api.tester.history_hint') }}
        </span>
        <UButton
          v-if="history.length"
          size="xs"
          color="neutral"
          variant="ghost"
          :label="t('api.tester.clear')"
          @click="clearHistory"
        />
      </template>
      <p v-if="history.length === 0" class="text-dimmed px-4 py-4 text-sm">
        {{ t('api.tester.history_empty') }}
      </p>
      <ul v-else class="divide-default divide-y">
        <li v-for="entry in history" :key="entry.at">
          <button
            type="button"
            class="hover:bg-elevated flex w-full items-center gap-3 px-4 py-2 text-left text-[12.5px]"
            @click="restore(entry)"
          >
            <ApiMethodBadge :method="entry.method" size="sm" />
            <ApiStatusBadge
              v-if="entry.result.status"
              :status="entry.result.status"
              size="sm"
            />
            <DmsStatusPill
              v-else
              :tone="entry.result.error === 'aborted' ? 'neutral' : 'error'"
              dot="none"
              size="sm"
              :label="
                entry.result.error === 'aborted'
                  ? t('api.tester.cancelled')
                  : t('api.tester.failed')
              "
            />
            <span class="text-default min-w-0 grow truncate font-mono">
              {{ readable(entry.path) }}
            </span>
            <span
              v-if="entry.result.abandoned"
              class="text-dimmed shrink-0 text-xs"
            >
              {{ t('api.tester.history_abandoned') }}
            </span>
            <span
              v-if="entry.result.auth !== 'session'"
              class="text-dimmed text-xs"
            >
              {{ t(`api.tester.auth_short.${entry.result.auth}`) }}
            </span>
            <span
              v-if="entry.result.bodySize"
              class="text-dimmed font-mono text-[11px]"
            >
              {{ formatBytes(entry.result.bodySize, locale) }}
            </span>
            <span class="text-muted font-mono text-[11px]">
              {{ formatMs(entry.result.durationMs, locale) }}
            </span>
            <span class="text-dimmed font-mono text-[11px]">
              {{ formatClock(entry.at, dateFormat) }}
            </span>
          </button>
        </li>
      </ul>
    </DmsCard>
    <p class="sr-only" aria-live="polite">{{ liveMessage }}</p>
  </div>
</template>
