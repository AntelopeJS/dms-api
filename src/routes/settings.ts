import {
  Controller,
  Get,
  HTTPResult,
  JSONBody,
  Parameter,
  Post,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { AuthUserWithPermission } from "@antelopejs/interface-dms/guards";
import {
  ApiSettingsModel,
  RequestLogModel,
  RouteModel,
  RouteStatisticsModel,
} from "@/db";
import { SettingsPage } from "@/pages/settings";
import {
  isSensitiveKey,
  REDACTED_KEY_WORDS,
} from "@/services/request-log/redaction";
import { countRoutes } from "@/services/route-catalog";
import { getScopedRouteKeys } from "@/services/scope";
import { getEffectiveSettings, updateSettings } from "@/services/settings";
import {
  changedFields,
  editableValues,
  logRetentionImpact,
  RETENTION_FIELDS,
  type RetentionField,
  SETTINGS_BOUNDS,
  SETTINGS_FIELDS,
  sensitiveHeaderNames,
  settingsSummary,
  statisticsRetentionImpact,
  toSettingsUpdate,
  validateSettings,
} from "@/services/settings-form";
import { CRITICAL_ERROR_RATE, ELEVATED_ERROR_RATE } from "@/types";

const HTTP_BAD_REQUEST = 400;

/**
 * The form's values: what is in force, in the units the form shows, and the
 * read-only lines beside them. The rates are ratios, worded by the form in
 * the reader's locale ("5%", "5 %").
 */
function settingsValues() {
  return {
    ...editableValues(getEffectiveSettings()),
    [SETTINGS_FIELDS.redacted]: [...REDACTED_KEY_WORDS],
    [SETTINGS_FIELDS.errorRate]: ELEVATED_ERROR_RATE,
    [SETTINGS_FIELDS.downRate]: CRITICAL_ERROR_RATE,
  };
}

function isRetentionField(value: unknown): value is RetentionField {
  return RETENTION_FIELDS.includes(value as RetentionField);
}

/**
 * The Settings form's route. The form loads the values in force and sends
 * them all back on save; only the fields that changed are validated and
 * written, and a cleared field returns to the module default. The answer is
 * the values as stored (header names in lower case, without repeats), which
 * the form shows once saved.
 */
export class SettingsController extends Controller("/api/monitoring/settings") {
  @Get("")
  getSettings(@AuthUserWithPermission(SettingsPage.form) _user: User) {
    return settingsValues();
  }

  @Post("")
  async submitSettings(
    @AuthUserWithPermission(SettingsPage.form) _user: User,
    @JSONBody() body: unknown,
  ) {
    const current = editableValues(getEffectiveSettings());
    const result = validateSettings(
      changedFields(body, current),
      isSensitiveKey,
    );
    if (!result.ok) throw new HTTPResult(HTTP_BAD_REQUEST, result.error);
    await updateSettings(
      GetModel(ApiSettingsModel),
      toSettingsUpdate(result.data),
    );
    return settingsValues();
  }

  /**
   * What the next hourly prune deletes once a retention field is set to
   * `days`: the days of data older than that, and the requests they hold.
   * The retention fields show it under a lowered value, and in the
   * confirmation asked before saving it.
   */
  @Get("retention-impact")
  async getRetentionImpact(
    @AuthUserWithPermission(SettingsPage.form) _user: User,
    @Parameter("field", "query") field: string,
    @Parameter("days", "query") rawDays: string,
  ) {
    const days = Number(rawDays);
    assert(isRetentionField(field), HTTP_BAD_REQUEST, "Unknown field");
    assert(
      Number.isInteger(days) &&
        days >= SETTINGS_BOUNDS.logRetentionDays.min &&
        days <= SETTINGS_BOUNDS.logRetentionDays.max,
      HTTP_BAD_REQUEST,
      "Invalid days",
    );
    return field === SETTINGS_FIELDS.statsRetention
      ? statisticsRetentionImpact(GetModel(RouteStatisticsModel), days)
      : logRetentionImpact(GetModel(RequestLogModel), days);
  }

  /**
   * Which of `names` the capture never stores (`authorization`, a cookie…):
   * the captured headers input asks as names are added, so such a name shows
   * red at once, by the same rule the save applies.
   */
  @Get("sensitive-headers")
  getSensitiveHeaders(
    @AuthUserWithPermission(SettingsPage.form) _user: User,
    @Parameter("names", "query") names: string | undefined,
  ) {
    return { sensitive: sensitiveHeaderNames(names ?? "", isSensitiveKey) };
  }

  /**
   * The settings every page of the console shows where they act: the scope
   * (and the routes it holds) for the scope chip, the slow threshold beside
   * the "Slow" filters, the retentions and the body cap. Open to whoever
   * opens the console (module pages are owner-only), unlike the form.
   */
  @Get("summary")
  async getSummary(@AuthOwnerOnly() _user: User) {
    const settings = getEffectiveSettings();
    const keys = await getScopedRouteKeys(GetModel(RouteModel), settings.scope);
    return settingsSummary(settings, countRoutes(keys));
  }
}
