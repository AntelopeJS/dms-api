import { Controller, Get, JSONBody, Post } from "@antelopejs/interface-api";
import { assertValidation } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { AuthUserWithPermission } from "@antelopejs/interface-dms/guards";
import { z } from "zod";
import { ApiSettingsModel } from "@/db";
import { SETTINGS_FIELDS, SettingsPage } from "@/pages/settings";
import { REDACTED_KEY_WORDS } from "@/services/request-log/redaction";
import { isRouteScope, ROUTE_SCOPES } from "@/services/scope";
import {
  getEffectiveSettings,
  updateSettings,
  type ApiSettingsUpdate,
} from "@/services/settings";
import { bytesToKb, moduleDefaults, msToDays } from "@/services/settings-form";
import { BYTES_PER_KB, ELEVATED_ERROR_RATE, MS_PER_DAY } from "@/types";

const PERCENT = 100;
const HEADER_NAME = /^[a-z0-9!#$%&'*+.^_`|~-]+$/;

const optionalNumber = (min: number, max: number) =>
  z.number().int().min(min).max(max).nullable().optional();

/**
 * The body the settings form sends: only the fields the user changed, `null`
 * for a field they cleared. Read-only fields are never written.
 */
const settingsBody = z.object({
  [SETTINGS_FIELDS.scope]: z
    .string()
    .refine(isRouteScope, { message: `One of ${ROUTE_SCOPES.join(", ")}` })
    .optional(),
  [SETTINGS_FIELDS.logRetention]: optionalNumber(1, 366),
  [SETTINGS_FIELDS.statsRetention]: optionalNumber(1, 366),
  [SETTINGS_FIELDS.maxBody]: optionalNumber(0, 10_240),
  [SETTINGS_FIELDS.slowThreshold]: optionalNumber(1, 600_000),
  [SETTINGS_FIELDS.headers]: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(HEADER_NAME, { message: "Not a header name" }),
    )
    .max(50)
    .nullable()
    .optional(),
});

type SettingsBody = z.infer<typeof settingsBody>;

/**
 * An override equal to the module default is no override: storing it would
 * pin the value if the default changes later.
 */
function override<T>(
  value: T | null | undefined,
  moduleDefault: T,
  toStored: (value: T) => unknown,
): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (JSON.stringify(value) === JSON.stringify(moduleDefault)) return null;
  return toStored(value);
}

function toUpdate(body: SettingsBody): ApiSettingsUpdate {
  const defaults = moduleDefaults();
  const headers = body[SETTINGS_FIELDS.headers];
  return {
    scope: body[SETTINGS_FIELDS.scope] as ApiSettingsUpdate["scope"],
    requestLogRetention: override(
      body[SETTINGS_FIELDS.logRetention],
      defaults.requestLogRetentionDays,
      (days) => days * MS_PER_DAY,
    ) as number | null | undefined,
    statisticsLifetime: override(
      body[SETTINGS_FIELDS.statsRetention],
      defaults.statisticsLifetimeDays,
      (days) => days * MS_PER_DAY,
    ) as number | null | undefined,
    requestLogMaxBodySize: override(
      body[SETTINGS_FIELDS.maxBody],
      defaults.requestLogMaxBodyKb,
      (kb) => kb * BYTES_PER_KB,
    ) as number | null | undefined,
    requestSlownessThreshold: override(
      body[SETTINGS_FIELDS.slowThreshold],
      defaults.requestSlownessThresholdMs,
      (ms) => ms,
    ) as number | null | undefined,
    requestLogCaptureHeaders: override(
      headers ? [...new Set(headers)] : headers,
      defaults.requestLogCaptureHeaders,
      (list) => list,
    ) as string[] | null | undefined,
  };
}

/** The form's values: what is in force, in the units the form shows. */
function settingsValues() {
  const settings = getEffectiveSettings();
  return {
    [SETTINGS_FIELDS.scope]: settings.scope,
    [SETTINGS_FIELDS.logRetention]: msToDays(settings.requestLogRetention),
    [SETTINGS_FIELDS.statsRetention]: msToDays(settings.statisticsLifetime),
    [SETTINGS_FIELDS.maxBody]: bytesToKb(settings.requestLogMaxBodySize),
    [SETTINGS_FIELDS.headers]: settings.requestLogCaptureHeaders,
    [SETTINGS_FIELDS.redacted]: [...REDACTED_KEY_WORDS],
    [SETTINGS_FIELDS.slowThreshold]: settings.requestSlownessThreshold,
    [SETTINGS_FIELDS.errorRate]: `${ELEVATED_ERROR_RATE * PERCENT} %`,
  };
}

/**
 * The Settings form's route. The form loads the values in force and sends
 * back the fields the user changed; a cleared field returns to the module
 * default.
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
    const data = assertValidation(body, (value) => settingsBody.parse(value));
    await updateSettings(GetModel(ApiSettingsModel), toUpdate(data));
    return settingsValues();
  }
}
