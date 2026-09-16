import { Form, formSchema } from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { HttpMethod } from "@antelopejs/interface-dms/base/types";

/**
 * Declarative settings form, shared between the Settings page (rendered by
 * DmsForm) and the /api/monitoring/settings endpoints (zod schema via
 * {@link apiSettingsFormSchema}).
 *
 * Field values use UI-friendly units (days / ms / KB); the endpoints convert
 * from/to the canonical config units (ms / bytes). Numeric fields are
 * optional: clearing one resets the override back to the module config
 * default. Select item labels are literal strings — the form renderer does
 * not resolve i18n tokens inside items (same limitation as core).
 */
export const apiSettingsForm = Form({
  fields: [
    {
      id: "scope-group",
      label: "$page.api.settings.scope.title",
      description: "$page.api.settings.scope.subtitle",
      fields: [
        {
          id: "scope",
          label: "$page.api.settings.scope.label",
          description: "$page.api.settings.scope.description",
          type: new DefaultDataTypes.SelectType({
            items: [
              { value: "own", label: "Own routes" },
              { value: "modules", label: "Module routes" },
              { value: "all", label: "All routes" },
            ],
            deselectable: false,
          }),
          required: true,
        },
      ],
    },
    {
      id: "requestLogRetentionDays",
      label: "$page.api.settings.retention.log_retention",
      description: "$page.api.settings.retention.log_retention_description",
      type: new DefaultDataTypes.NumberType({
        min: 1,
        max: 366,
        step: 1,
        placeholder: "30",
      }),
    },
    {
      id: "statisticsLifetimeDays",
      label: "$page.api.settings.retention.stats_retention",
      description: "$page.api.settings.retention.stats_retention_description",
      type: new DefaultDataTypes.NumberType({
        min: 1,
        max: 366,
        step: 1,
        placeholder: "30",
      }),
    },
    {
      id: "requestSlownessThresholdMs",
      label: "$page.api.settings.retention.slowness",
      description: "$page.api.settings.retention.slowness_description",
      type: new DefaultDataTypes.NumberType({
        min: 1,
        max: 600_000,
        step: 50,
        placeholder: "1000",
      }),
    },
    {
      id: "requestLogMaxBodyKb",
      label: "$page.api.settings.retention.max_body",
      description: "$page.api.settings.retention.max_body_description",
      type: new DefaultDataTypes.NumberType({
        min: 0,
        max: 10_240,
        step: 1,
        placeholder: "64",
      }),
    },
  ],
  fetchUrl: "/api/monitoring/settings",
  submitUrl: "/api/monitoring/settings",
  submitUrlMethod: HttpMethod.post,
});

export const apiSettingsFormSchema: ReturnType<typeof formSchema> =
  formSchema(apiSettingsForm);
