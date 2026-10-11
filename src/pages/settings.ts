import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { TagsType } from "@antelopejs/interface-dms/base/data-types/field-types";
import {
  Form,
  type FormFieldOrGroupSerialized,
  type FormPropsSerialized,
} from "@antelopejs/interface-dms/base/form";
import { FormPageLayout } from "@antelopejs/interface-dms/base/layouts";
import { HttpMethod } from "@antelopejs/interface-dms/base/types";
import type { ComponentInfoSerialized } from "@antelopejs/interface-dms/component";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import {
  DEFAULT_STATISTICS_LIFETIME_DAYS,
  STATISTICS_LIFETIME_DAY_CHOICES,
} from "@/config";
import {
  getSettingsFormContext,
  SETTINGS_BOUNDS,
  SETTINGS_FIELDS,
} from "@/services/settings-form";
import { configureCategory } from "./module";

const SETTINGS_URL = "/api/monitoring/settings";
const RETENTION_IMPACT_URL = `${SETTINGS_URL}/retention-impact`;

/** An input of the console's own, in place of the type's default one. */
function apiInput<T>(name: string, options: T): ComponentInfoSerialized<T> {
  return { componentName: `DmsApi${name}`, options };
}

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

const { logRetentionDays, maxBodyKb, slowThresholdMs, capturedHeaders } =
  SETTINGS_BOUNDS;

/**
 * The numbers of the form are drawn by `SettingNumberInput`, the DMS number
 * input at the width of a number, which says how it corrected a typed value
 * ("1020 → 1,000") and takes the focus from a link to its field. The headers
 * are drawn by `SettingTagsInput`, the DMS tags input that does the latter.
 */
const maxBodyInput = { min: maxBodyKb.min, max: maxBodyKb.max, step: 1 };

const headersInput = {
  max: capturedHeaders.max,
  placeholder: "$api.settings.capture.headers_placeholder",
  suggestions: ["stripe-signature", "x-forwarded-for", "x-idempotency-key"],
};

const retentionType = new DefaultDataTypes.NumberType({
  min: logRetentionDays.min,
  max: logRetentionDays.max,
  step: 1,
});

const statisticsRetentionType = new DefaultDataTypes.NumberType({
  min: Math.min(...STATISTICS_LIFETIME_DAY_CHOICES),
  max: Math.max(...STATISTICS_LIFETIME_DAY_CHOICES),
  step: STATISTICS_LIFETIME_DAY_CHOICES[0],
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
          hint: "$api.settings.retention.logs_hint",
          type: retentionType,
          inputComponent: apiInput("RetentionInput", {
            kind: "logs",
            min: logRetentionDays.min,
            max: logRetentionDays.max,
            impactUrl: RETENTION_IMPACT_URL,
          }),
        },
        {
          // 30, 60 or 90 days: the steps of 30 from 30 to 90.
          id: SETTINGS_FIELDS.statsRetention,
          label: "$api.settings.retention.statistics",
          description: "$api.settings.retention.statistics_description",
          type: statisticsRetentionType,
          inputComponent: apiInput("RetentionInput", {
            kind: "statistics",
            choices: [...STATISTICS_LIFETIME_DAY_CHOICES],
            defaultChoice: DEFAULT_STATISTICS_LIFETIME_DAYS,
            impactUrl: RETENTION_IMPACT_URL,
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
          type: new DefaultDataTypes.NumberType(maxBodyInput),
          inputComponent: apiInput("SettingNumberInput", maxBodyInput),
        },
        {
          id: SETTINGS_FIELDS.headers,
          label: "$api.settings.capture.headers",
          description: "$api.settings.capture.headers_description",
          hint: "$api.settings.capture.headers_hint",
          // The route checks the names: one HTTP does not allow, or one the
          // capture never stores, comes back as a field error naming it,
          // which the DMS input shows red.
          type: new TagsType(headersInput),
          inputComponent: apiInput("SettingTagsInput", headersInput),
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
          // Steps from 50, so round values stay round: a minimum of 1 put
          // the grid on 1 + 50·k (1000 became 1001).
          id: SETTINGS_FIELDS.slowThreshold,
          label: "$api.settings.thresholds.slow",
          description: "$api.settings.thresholds.slow_description",
          hint: "$api.settings.thresholds.slow_hint",
          type: new DefaultDataTypes.NumberType(slowThresholdMs),
          inputComponent: apiInput("SettingNumberInput", slowThresholdMs),
        },
        {
          id: SETTINGS_FIELDS.errorRate,
          label: "$api.settings.thresholds.error_rate",
          description: "$api.settings.thresholds.error_rate_description",
          type: new DefaultDataTypes.PercentageType(),
          readonly: {
            badge: { label: "$api.settings.thresholds.fixed", tone: "neutral" },
          },
        },
        {
          id: SETTINGS_FIELDS.downRate,
          label: "$api.settings.thresholds.down_rate",
          description: "$api.settings.thresholds.down_rate_description",
          type: new DefaultDataTypes.PercentageType(),
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
 * The module defaults depend on the module config, not on the page: they are
 * filled in for each request.
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
 * Changes apply at once, without a restart. Named "API settings", with its
 * own icon, beside the platform's Settings in the sidebar.
 */
@RegisterPage()
export class SettingsPage extends PageController(
  "settings",
  {
    displayName: "$api.settings.title",
    description: "$api.settings.description",
    icon: "i-ph-sliders",
    module: "api",
    category: configureCategory,
    order: 0,
  },
  FormPageLayout(),
) {
  static form = settingsForm;
}
