import { afterEach, describe, expect, it } from "vitest";
import { setConfig } from "@/config";
import {
  configErrors,
  editableValues,
  getSettingsFormContext,
  INVALID_HEADER_MESSAGE,
  logRetentionImpact,
  SENSITIVE_HEADER_MESSAGE,
  SETTINGS_FIELDS,
  settingsSummary,
  statisticsRetentionImpact,
  toSettingsUpdate,
  validateSettings,
} from "@/services/settings-form";
import type { ApiSettingsPayload } from "@/services/settings";
import type { JsonValue } from "@antelopejs/interface-dms/base/types/json";
import { type DayStatistics, MS_PER_DAY } from "@/types";

const settings: ApiSettingsPayload = {
  scope: "own",
  statisticsLifetime: 90 * MS_PER_DAY,
  requestLogRetention: 30 * MS_PER_DAY,
  requestSlownessThreshold: 800,
  requestLogMaxBodySize: 64 * 1024,
  requestLogCaptureHeaders: ["content-type"],
};

const current = editableValues(settings);
const neverSensitive = (_name: string) => false;

/** What the form sends: every field, the read-only ones included. */
function formBody(changes: Record<string, JsonValue>) {
  return {
    ...current,
    [SETTINGS_FIELDS.redacted]: ["password"],
    [SETTINGS_FIELDS.errorRate]: 0.05,
    ...changes,
  };
}

function validate(
  changes: Record<string, JsonValue>,
  sensitive: (name: string) => boolean = neverSensitive,
) {
  return validateSettings(changes, sensitive);
}

afterEach(() => setConfig());

describe("the whole form body", () => {
  it("validates every editable field and leaves the read-only ones out", () => {
    expect(validateSettings(formBody({}), neverSensitive)).toEqual({
      ok: true,
      data: current,
    });
  });

  it("refuses a body that is not an object", () => {
    expect(validateSettings(null, neverSensitive).ok).toBe(false);
    expect(validateSettings([1], neverSensitive).ok).toBe(false);
  });
});

describe("configErrors", () => {
  it("accepts the module defaults", () => {
    const { scope: _scope, ...config } = settings;
    expect(configErrors(config, neverSensitive)).toEqual([]);
  });

  it("names what the form would refuse to save back", () => {
    const { scope: _scope, ...config } = settings;
    const errors = configErrors(
      {
        ...config,
        statisticsLifetime: 45 * MS_PER_DAY,
        requestSlownessThreshold: 1001,
      },
      neverSensitive,
    );
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/^statisticsLifetimeDays: /);
    expect(errors[1]).toMatch(/^requestSlownessThresholdMs: /);
  });

  it("names a secret header set to be captured", () => {
    const { scope: _scope, ...config } = settings;
    expect(
      configErrors(
        { ...config, requestLogCaptureHeaders: ["authorization"] },
        (name) => name === "authorization",
      ),
    ).toEqual([
      `requestLogCaptureHeaders: ${SENSITIVE_HEADER_MESSAGE} (authorization)`,
    ]);
  });
});

describe("validateSettings", () => {
  it.each([30, 60, 90])("accepts %i days of statistics", (days) => {
    expect(validate({ [SETTINGS_FIELDS.statsRetention]: days }).ok).toBe(true);
  });

  it.each([45, 1, 366])("refuses %i days of statistics", (days) => {
    expect(validate({ [SETTINGS_FIELDS.statsRetention]: days }).ok).toBe(false);
  });

  it.each([50, 1000, 2000, 600_000])(
    "keeps a slow threshold of %i ms as it is",
    (ms) => {
      expect(validate({ [SETTINGS_FIELDS.slowThreshold]: ms })).toEqual({
        ok: true,
        data: { [SETTINGS_FIELDS.slowThreshold]: ms },
      });
    },
  );

  it.each([0, 1, 1001, 600_050])("refuses a slow threshold of %i ms", (ms) => {
    expect(validate({ [SETTINGS_FIELDS.slowThreshold]: ms }).ok).toBe(false);
  });

  it("stores header names trimmed and in lower case", () => {
    const result = validate({
      [SETTINGS_FIELDS.headers]: [" X-Request-Id ", "content-type"],
    });
    expect(result).toEqual({
      ok: true,
      data: { [SETTINGS_FIELDS.headers]: ["x-request-id", "content-type"] },
    });
  });

  it("names the header names HTTP does not allow", () => {
    expect(
      validate({ [SETTINGS_FIELDS.headers]: ["x(bad)", "x-ok", "a b"] }),
    ).toEqual({
      ok: false,
      error: {
        field: SETTINGS_FIELDS.headers,
        message: INVALID_HEADER_MESSAGE,
        values: ["x(bad)", "a b"],
      },
    });
  });

  it("names the headers the capture never stores", () => {
    const result = validate(
      { [SETTINGS_FIELDS.headers]: ["authorization", "x-ok"] },
      (name) => name === "authorization",
    );
    expect(result).toEqual({
      ok: false,
      error: {
        field: SETTINGS_FIELDS.headers,
        message: SENSITIVE_HEADER_MESSAGE,
        values: ["authorization"],
      },
    });
  });

  it("answers zod's issues for another refused field", () => {
    const result = validate({ [SETTINGS_FIELDS.logRetention]: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Array.isArray(result.error)).toBe(true);
    if (!Array.isArray(result.error)) return;
    expect(result.error[0]?.path).toEqual([SETTINGS_FIELDS.logRetention]);
  });
});

describe("toSettingsUpdate", () => {
  it("stores a value equal to the module default as no override", () => {
    setConfig();
    expect(
      toSettingsUpdate({
        [SETTINGS_FIELDS.statsRetention]: 90,
        [SETTINGS_FIELDS.logRetention]: 7,
        [SETTINGS_FIELDS.slowThreshold]: 1000,
      }),
    ).toMatchObject({
      statisticsLifetime: null,
      requestLogRetention: 7 * MS_PER_DAY,
      requestSlownessThreshold: null,
    });
  });

  it("drops repeated header names", () => {
    expect(
      toSettingsUpdate({ [SETTINGS_FIELDS.headers]: ["a", "a", "b"] })
        .requestLogCaptureHeaders,
    ).toEqual(["a", "b"]);
  });
});

describe("getSettingsFormContext", () => {
  it("offers no 'Use default' on the retentions", () => {
    const { patches } = getSettingsFormContext();
    expect(patches[SETTINGS_FIELDS.logRetention]).toBeUndefined();
    expect(patches[SETTINGS_FIELDS.statsRetention]).toBeUndefined();
    expect(patches[SETTINGS_FIELDS.slowThreshold]).toEqual({
      defaultValue: 1000,
      offersDefault: true,
    });
  });
});

describe("retention impact", () => {
  const today = new Date("2026-10-10T00:00:00.000Z").getTime();
  const day = (daysAgo: number, requestsCount: number): DayStatistics => ({
    day: today - daysAgo * MS_PER_DAY,
    requestsCount,
    averageResponseTime: 0,
    minResponseTime: 0,
    maxResponseTime: 0,
    totalResponseTime: 0,
    clientErrorsCount: 0,
    serverErrorsCount: 0,
    timedRequestsCount: 0,
    latencyHistogram: [],
  });

  it("counts the statistics days older than the new retention", async () => {
    const stats = {
      getAll: async () => [
        { statistics: [day(10, 5), day(40, 100), day(80, 50)] },
        { statistics: [day(40, 7), day(29, 1000)] },
      ],
    };
    expect(await statisticsRetentionImpact(stats, 30, today)).toEqual({
      days: 2,
      requests: 157,
    });
    expect(await statisticsRetentionImpact(stats, 90, today)).toEqual({
      days: 0,
      requests: 0,
    });
  });

  it("counts the request logs older than the new retention", async () => {
    const now = new Date("2026-10-10T12:00:00.000Z");
    let asked: { until: Date } | undefined;
    const logs = {
      list: async (filters: { until: Date }) => {
        asked = filters;
        return {
          results: [{ timestamp: new Date(now.getTime() - 30 * MS_PER_DAY) }],
          total: 1234,
        };
      },
    };
    expect(await logRetentionImpact(logs, 7, now)).toEqual({
      days: 23,
      requests: 1234,
    });
    expect(asked?.until).toEqual(new Date(now.getTime() - 7 * MS_PER_DAY));
  });

  it("deletes nothing when no log is that old", async () => {
    const logs = { list: async () => ({ results: [], total: 0 }) };
    expect(await logRetentionImpact(logs, 7)).toEqual({ days: 0, requests: 0 });
  });
});

describe("settingsSummary", () => {
  it("gives the settings in the units the pages show", () => {
    expect(settingsSummary(settings, 17)).toEqual({
      scope: "own",
      routes: 17,
      requestSlownessThresholdMs: 800,
      statisticsLifetimeDays: 90,
      requestLogRetentionDays: 30,
      requestLogMaxBodyKb: 64,
    });
  });
});
