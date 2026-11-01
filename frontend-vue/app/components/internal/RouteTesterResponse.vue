<script setup lang="ts">
import {
  byteLength,
  formatBytes,
  formatClock,
  formatMs,
  prettyBody,
} from '../../utils/format'
import { neverSent, PROXY_TIMEOUT_MS } from '../../utils/testerRequest'
import ApiKeyValues from './ApiKeyValues.vue'
import ApiStatusBadge from './ApiStatusBadge.vue'
import type { TesterContext } from './routeTester/context'

// The tester's answer card: the response, its headers and what the module captured of it.
const props = defineProps<{ tester: TesterContext }>()

const {
  capturedAvailable,
  capturedLog,
  capturedSlow,
  capturedState,
  dateFormat,
  errorCopy,
  locale,
  logsLink,
  responseBody,
  responseSize,
  responseTab,
  responseTabs,
  result,
  routeCaptured,
  sending,
  shortId,
  shortcut,
  t,
  useSession,
} = props.tester
</script>

<template>
  <DmsCard :padded="false" class="min-w-0">
    <div v-if="!result" class="px-4 py-10">
      <DmsEmptyState
        size="sm"
        :icon="sending ? 'i-ph-hourglass-medium' : 'i-ph-paper-plane-tilt'"
        :title="
          sending
            ? t('api.tester.waiting_title')
            : t('api.tester.no_response_title')
        "
        :description="
          sending
            ? t('api.tester.waiting_description', {
                seconds: PROXY_TIMEOUT_MS / 1000,
              })
            : t('api.tester.no_response_description', { shortcut })
        "
      />
    </div>
    <template v-else>
      <div
        class="border-default flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5"
      >
        <ApiStatusBadge v-if="result.status" :status="result.status" text />
        <DmsStatusPill
          v-else
          :tone="result.error === 'aborted' ? 'neutral' : 'error'"
          dot="none"
          :label="
            result.error === 'aborted'
              ? t('api.tester.cancelled')
              : t('api.tester.failed')
          "
        />
        <UTooltip :text="t('api.tester.duration_tooltip')">
          <span class="text-muted font-mono text-[12px]" tabindex="0">
            {{
              t('api.tester.duration_browser', {
                duration: formatMs(result.durationMs, locale),
              })
            }}
            <template
              v-if="result.captured && result.captured.responseTimeMs !== null"
            >
              ·
              <span :class="capturedSlow ? 'text-warning font-semibold' : ''">
                {{
                  t('api.tester.duration_server', {
                    duration: formatMs(result.captured.responseTimeMs, locale),
                  })
                }}
              </span>
            </template>
          </span>
        </UTooltip>
        <span
          v-if="result.body || result.bodySize"
          class="text-muted font-mono text-[12px]"
        >
          {{ formatBytes(responseSize, locale) }}
        </span>
        <span class="grow" />
        <UButton
          v-if="!neverSent(result.error) && logsLink"
          :to="logsLink"
          size="xs"
          variant="link"
          trailing-icon="i-ph-arrow-right"
          :label="
            result.captured
              ? t('api.tester.open_captured')
              : t('api.tester.open_logs')
          "
        />
        <UTooltip
          v-else-if="!routeCaptured"
          :text="t('api.tester.not_captured_hint')"
        >
          <span class="text-dimmed text-xs" tabindex="0">
            {{ t('api.tester.not_captured') }}
          </span>
        </UTooltip>
      </div>
      <div class="flex flex-col gap-2 p-3">
        <DmsBanner
          v-if="errorCopy"
          :tone="result.error === 'aborted' ? 'info' : 'error'"
          size="sm"
          :icon="errorCopy.icon"
          :title="errorCopy.title"
          :description="errorCopy.description"
        />
        <DmsBanner
          v-else-if="result.status === 401"
          tone="warning"
          size="sm"
          icon="i-ph-lock-simple"
          :title="t('api.tester.unauthorized_title')"
          :description="t(`api.tester.unauthorized.${result.auth}`)"
        >
          <template v-if="result.auth === 'none'" #actions>
            <UButton
              size="xs"
              color="neutral"
              variant="outline"
              :label="t('api.tester.turn_on_session')"
              @click="useSession = true"
            />
          </template>
        </DmsBanner>
        <UTabs
          v-if="responseTabs.length"
          v-model="responseTab"
          :items="responseTabs"
          :content="false"
          variant="link"
          size="sm"
        />
        <template v-if="responseTab === 'captured' && capturedAvailable">
          <p
            v-if="capturedState === 'loading' || capturedState === 'idle'"
            class="text-dimmed text-sm"
          >
            {{ t('api.tester.captured.loading') }}
          </p>
          <p
            v-else-if="capturedState === 'missing'"
            class="text-dimmed text-sm"
          >
            {{
              t('api.tester.captured.missing', {
                id: shortId(result.requestId ?? ''),
              })
            }}
          </p>
          <p v-else-if="capturedState === 'error'" class="text-error text-sm">
            {{ t('api.tester.captured.error') }}
          </p>
          <div v-else-if="capturedLog" class="flex flex-col gap-3">
            <div
              class="text-muted flex flex-wrap items-center gap-3 font-mono text-[12px]"
            >
              <ApiStatusBadge :status="capturedLog.statusCode" text size="sm" />
              <span
                v-if="capturedLog.responseTimeMs !== null"
                :class="capturedSlow ? 'text-warning font-semibold' : ''"
              >
                {{
                  t('api.tester.duration_server', {
                    duration: formatMs(capturedLog.responseTimeMs, locale),
                  })
                }}
              </span>
              <span>
                {{ formatClock(capturedLog.timestamp, dateFormat) }}
              </span>
              <span>{{ shortId(capturedLog._id) }}</span>
            </div>
            <DmsBanner
              v-if="capturedLog.error"
              tone="error"
              size="sm"
              icon="i-ph-bug"
              :title="capturedLog.error.message"
            />
            <DmsCodeSnippet
              v-if="capturedLog.error?.stack"
              :code="capturedLog.error.stack"
              :title="t('api.tester.captured.stack')"
              max-height="12rem"
              wrap="anywhere"
            />
            <div class="flex flex-col gap-1.5">
              <p class="text-default text-xs font-medium">
                {{ t('api.tester.captured.headers') }}
              </p>
              <ApiKeyValues
                :values="capturedLog.requestHeaders"
                :empty="t('api.request.no_headers')"
              />
            </div>
            <DmsCodeSnippet
              v-if="capturedLog.requestBody"
              :code="prettyBody(capturedLog.requestBody).text"
              :title="t('api.tester.captured.body')"
              max-height="16rem"
              wrap="anywhere"
            />
            <p
              v-else-if="capturedLog.requestBodyOmitted"
              class="text-dimmed text-xs"
            >
              {{
                t('api.tester.captured.body_omitted', {
                  reason: t(
                    `api.tester.body_omitted.${capturedLog.requestBodyOmitted}`,
                  ),
                })
              }}
            </p>
          </div>
        </template>
        <template v-else-if="!result.error">
          <template v-if="responseTab === 'body'">
            <DmsCodeSnippet
              v-if="responseBody.text"
              :code="responseBody.text"
              max-height="24rem"
              wrap="anywhere"
            />
            <p v-else class="text-dimmed text-sm">
              {{ t('api.request.no_body') }}
            </p>
            <p v-if="result.bodyTruncated" class="text-warning text-xs">
              {{
                t('api.tester.truncated_in_history', {
                  shown: formatBytes(byteLength(result.body), locale),
                  size: formatBytes(responseSize, locale),
                })
              }}
            </p>
          </template>
          <ApiKeyValues
            v-else
            :values="result.headers"
            :empty="t('api.request.no_headers')"
          />
        </template>
      </div>
    </template>
  </DmsCard>
</template>
