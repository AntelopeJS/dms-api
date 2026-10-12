import { describe, expect, it } from "vitest";
import { SettingsPage } from "@/pages/settings";

interface SerializedField {
  id: string;
  component?: { componentName: string; options?: Record<string, unknown> };
}

const form = SettingsPage.form.serializeSync() as {
  options: { fields: SerializedField[] };
};

function inputOf(id: string) {
  const field = form.options.fields.find((entry) => entry.id === id);
  if (!field) throw new Error(`no field ${id}`);
  return field.component;
}

describe("SettingsPage", () => {
  it("draws its numbers with the console's number input, on their bounds", () => {
    expect(inputOf("requestLogMaxBodyKb")).toEqual({
      componentName: "DmsApiSettingNumberInput",
      options: { min: 0, max: 10_240, step: 1 },
    });
    expect(inputOf("requestSlownessThresholdMs")).toEqual({
      componentName: "DmsApiSettingNumberInput",
      options: { min: 50, max: 600_000, step: 50 },
    });
  });

  it("lays the three route scopes on one row of cards", () => {
    expect(inputOf("scope")).toMatchObject({
      componentName: "dms-choice-cards",
      options: { columns: 3 },
    });
  });

  it("keeps the retentions on the console's inputs", () => {
    expect(inputOf("requestLogRetentionDays")?.componentName).toBe(
      "DmsApiRetentionInput",
    );
    expect(inputOf("statisticsLifetimeDays")?.options).toMatchObject({
      choices: [30, 60, 90],
    });
  });

  it("draws the headers with the DMS tags input", () => {
    expect(inputOf("requestLogCaptureHeaders")?.componentName).not.toMatch(
      /^DmsApi/,
    );
    expect(inputOf("requestLogCaptureHeaders")?.options).toMatchObject({
      max: 50,
    });
  });
});
