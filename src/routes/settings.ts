import { Controller, Get, JSONBody, Post } from "@antelopejs/interface-api";
import { assertValidation } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { ApiSettingsModel } from "@/db";
import { apiSettingsFormSchema } from "@/pages/settings/form";
import { getMaxLogDays, getMaxStatsDays } from "@/services/period";
import type { RouteScope } from "@/services/scope";
import { getEffectiveSettings, updateSettings } from "@/services/settings";
import { MS_PER_DAY } from "@/types";

const BYTES_PER_KB = 1024;

/**
 * Fetch/submit endpoints for the declarative Settings form (see
 * `src/pages/settings/form.ts`). The wire format is the form's field ids in
 * UI units (days / ms / KB); conversion to the canonical config units
 * (ms / bytes) happens here. A null/absent numeric field clears the override
 * back to the module config default.
 */
@AuthOwnerOnly()
export class SettingsController extends Controller("/api/monitoring/settings") {
  @Get("")
  async getSettings(@AuthRawUser() _user: User) {
    return formValues();
  }

  /**
   * The retentions alone, for the period selectors on the monitoring pages:
   * they can only offer windows the data reaches back to. Kept apart from the
   * form payload above so those pages don't couple to the form's field ids,
   * and served by the same functions that clamp the windows those selectors go
   * on to request.
   *
   * Two of them, because the pages read two different stores: the Overview and
   * Routes charts come from the day rollups (`statisticsLifetime`), the Logs
   * page from the raw request logs (`requestLogRetention`).
   */
  @Get("retention")
  async getRetention(@AuthRawUser() _user: User) {
    return {
      statisticsLifetimeDays: getMaxStatsDays(),
      requestLogRetentionDays: getMaxLogDays(),
    };
  }

  @Post("")
  async submitSettings(@AuthRawUser() _user: User, @JSONBody() body: unknown) {
    const data = assertValidation(body, (v) => apiSettingsFormSchema.parse(v));
    await updateSettings(GetModel(ApiSettingsModel), {
      scope: data.scope as RouteScope,
      requestLogRetention: fromUi(data.requestLogRetentionDays, MS_PER_DAY),
      statisticsLifetime: fromUi(data.statisticsLifetimeDays, MS_PER_DAY),
      requestSlownessThreshold: fromUi(data.requestSlownessThresholdMs, 1),
      requestLogMaxBodySize: fromUi(data.requestLogMaxBodyKb, BYTES_PER_KB),
    });
    return formValues();
  }
}

function formValues() {
  const s = getEffectiveSettings();
  return {
    scope: s.scope,
    requestLogRetentionDays: msToDays(s.requestLogRetention),
    statisticsLifetimeDays: msToDays(s.statisticsLifetime),
    requestSlownessThresholdMs: s.requestSlownessThreshold,
    requestLogMaxBodyKb: Math.round(s.requestLogMaxBodySize / BYTES_PER_KB),
  };
}

function msToDays(ms: number): number {
  return Math.max(1, Math.round(ms / MS_PER_DAY));
}

/** Empty form field (null/undefined) clears the override; a number sets it. */
function fromUi(value: unknown, unit: number): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.round(value * unit);
}
