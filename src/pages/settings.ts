import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { TagsType } from "@antelopejs/interface-dms/base/data-types/field-types";
import {
  Form,
  type FormFieldOrGroupSerialized,
  type FormPropsSerialized,
} from "@antelopejs/interface-dms/base/form";
import { FormPageLayout } from "@antelopejs/interface-dms/base/layouts";
import { HttpMethod } from "@antelopejs/interface-dms/base/types";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { getSettingsFormContext } from "@/services/settings-form";
import { configureCategory } from "./module";

/** Field ids of the settings form: the keys its route reads and answers. */
export const SETTINGS_FIELDS = {
  scope: "scope",
  logRetention: "requestLogRetentionDays",
  statsRetention: "statisticsLifetimeDays",
  maxBody: "requestLogMaxBodyKb",
  headers: "requestLogCaptureHeaders",
  redacted: "redactedKeys",
  slowThreshold: "requestSlownessThresholdMs",
  errorRate: "errorRateWarning",
} as const;

const SETTINGS_URL = "/api/monitoring/settings";
const MAX_RETENTION_DAYS = 366;
const MAX_SLOW_MS = 600_000;
const MAX_BODY_KB = 10_240;
const MAX_CAPTURED_HEADERS = 50;

const scopeType = new DefaultDataTypes.SelectType({
  display: "cards",
  deselectable: false,
  items: [
    {
      value: "own",
      label: "$api.settings.scope.own",
      description: "$api.settings.scope.own_description",
      icon: "i-ph-code",
    },
    {
      value: "modules",
      label: "$api.settings.scope.modules",
      description: "$api.settings.scope.modules_description",
      icon: "i-ph-puzzle-piece",
    },
    {
      value: "all",
      label: "$api.settings.scope.all",
      description: "$api.settings.scope.all_description",
      icon: "i-ph-stack",
    },
  ],
});

const settingsForm = Form({
  fetchUrl: SETTINGS_URL,
  submitUrl: SETTINGS_URL,
  submitUrlMethod: HttpMethod.post,
  successMessage: "$api.settings.saved",
  sectionNav: "none",
  sections: [
    {
      id: "visibility",
      label: "$api.settings.sections.visibility",
      description: "$api.settings.sections.visibility_description",
      icon: "i-ph-eye",
      fields: [
        {
          id: SETTINGS_FIELDS.scope,
          label: "$api.settings.scope.label",
          description: "$api.settings.scope.description",
          type: scopeType,
          required: true,
        },
      ],
    },
    {
      id: "retention",
      label: "$api.settings.sections.retention",
      description: "$api.settings.sections.retention_description",
      icon: "i-ph-clock-counter-clockwise",
      fields: [
        {
          id: SETTINGS_FIELDS.logRetention,
          label: "$api.settings.retention.logs",
          description: "$api.settings.retention.logs_description",
          type: new DefaultDataTypes.NumberType({
            min: 1,
            max: MAX_RETENTION_DAYS,
            step: 1,
          }),
        },
        {
          id: SETTINGS_FIELDS.statsRetention,
          label: "$api.settings.retention.statistics",
          description: "$api.settings.retention.statistics_description",
          type: new DefaultDataTypes.NumberType({
            min: 1,
            max: MAX_RETENTION_DAYS,
            step: 1,
          }),
        },
      ],
    },
    {
      id: "capture",
      label: "$api.settings.sections.capture",
      description: "$api.settings.sections.capture_description",
      icon: "i-ph-shield-check",
      fields: [
        {
          id: SETTINGS_FIELDS.maxBody,
          label: "$api.settings.capture.max_body",
          description: "$api.settings.capture.max_body_description",
          hint: "$api.settings.capture.max_body_hint",
          type: new DefaultDataTypes.NumberType({
            min: 0,
            max: MAX_BODY_KB,
            step: 1,
          }),
        },
        {
          id: SETTINGS_FIELDS.headers,
          label: "$api.settings.capture.headers",
          description: "$api.settings.capture.headers_description",
          hint: "$api.settings.capture.headers_hint",
          type: new TagsType({
            max: MAX_CAPTURED_HEADERS,
            placeholder: "$api.settings.capture.headers_placeholder",
            suggestions: [
              "authorization",
              "stripe-signature",
              "x-request-id",
              "x-forwarded-for",
              "x-idempotency-key",
            ],
          }),
        },
        {
          id: SETTINGS_FIELDS.redacted,
          label: "$api.settings.capture.redacted",
          description: "$api.settings.capture.redacted_description",
          hint: "$api.settings.capture.redacted_hint",
          type: new TagsType(),
          readonly: {
            badge: { label: "$api.settings.capture.always", tone: "neutral" },
          },
        },
      ],
    },
    {
      id: "thresholds",
      label: "$api.settings.sections.thresholds",
      description: "$api.settings.sections.thresholds_description",
      icon: "i-ph-gauge",
      fields: [
        {
          id: SETTINGS_FIELDS.slowThreshold,
          label: "$api.settings.thresholds.slow",
          description: "$api.settings.thresholds.slow_description",
          type: new DefaultDataTypes.NumberType({
            min: 1,
            max: MAX_SLOW_MS,
            step: 50,
          }),
        },
        {
          id: SETTINGS_FIELDS.errorRate,
          label: "$api.settings.thresholds.error_rate",
          description: "$api.settings.thresholds.error_rate_description",
          type: new DefaultDataTypes.StringType(),
          readonly: {
            badge: { label: "$api.settings.thresholds.fixed", tone: "neutral" },
          },
        },
      ],
    },
  ],
}).meta({ name: "$api.settings.form", icon: "i-ph-sliders-horizontal" });

type FieldPatch = Record<string, unknown>;

function patchFields(
  fields: FormFieldOrGroupSerialized[],
  patches: Record<string, FieldPatch>,
): FormFieldOrGroupSerialized[] {
  return fields.map((field) => {
    const patch = patches[field.id];
    return patch
      ? ({ ...field, ...patch } as FormFieldOrGroupSerialized)
      : field;
  });
}

/**
 * The module defaults and the live hints depend on the module config and the
 * stored data, not on the page: they are filled in for each request.
 */
settingsForm.onFilter((_permissions, options: FormPropsSerialized) => {
  const context = getSettingsFormContext();
  return {
    ...options,
    fields: patchFields(options.fields, context.patches),
  };
});

/**
 * Settings: which routes the console watches, how long it keeps what it
 * captures, what a request log keeps, and when a route needs attention.
 * Changes apply at once, without a restart.
 */
@RegisterPage()
export class SettingsPage extends PageController(
  "settings",
  {
    displayName: "$api.settings.title",
    description: "$api.settings.description",
    icon: "i-ph-gear-six",
    module: "api",
    category: configureCategory,
    order: 0,
  },
  FormPageLayout(),
) {
  static form = settingsForm;
}
