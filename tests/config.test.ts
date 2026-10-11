import { describe, expect, it } from "vitest";
import {
  applyConfigOverrides,
  DEFAULT_STATISTICS_LIFETIME_DAYS,
  getBaseConfig,
  getConfig,
  setConfig,
  STATISTICS_LIFETIME_DAY_CHOICES,
} from "@/config";
import { MS_PER_DAY } from "@/types";

describe("config", () => {
  it("replaces a list instead of adding the defaults to it", () => {
    setConfig({
      requestLogCaptureHeaders: ["content-type", "stripe-signature"],
    });
    expect(getConfig().requestLogCaptureHeaders).toEqual([
      "content-type",
      "stripe-signature",
    ]);
  });

  it("lets a settings override win, and an undefined one fall through", () => {
    setConfig({ requestSlownessThreshold: 800 });
    applyConfigOverrides({
      requestSlownessThreshold: undefined,
      requestLogMaxBodySize: 0,
    });
    expect(getConfig().requestSlownessThreshold).toBe(800);
    expect(getConfig().requestLogMaxBodySize).toBe(0);
    expect(getBaseConfig().requestLogMaxBodySize).toBe(65_536);
    applyConfigOverrides({});
    setConfig();
  });

  it("keeps statistics 90 days and request logs 30 days by default", () => {
    setConfig();
    expect(DEFAULT_STATISTICS_LIFETIME_DAYS).toBe(90);
    expect(STATISTICS_LIFETIME_DAY_CHOICES).toEqual([30, 60, 90]);
    expect(STATISTICS_LIFETIME_DAY_CHOICES).toContain(
      DEFAULT_STATISTICS_LIFETIME_DAYS,
    );
    expect(getConfig().statisticsLifetime).toBe(90 * MS_PER_DAY);
    expect(getConfig().requestLogRetention).toBe(30 * MS_PER_DAY);
  });

  it("leaves the public API URL unset unless the module config sets it", () => {
    setConfig();
    expect(getConfig().publicApiUrl).toBeUndefined();
    setConfig({ publicApiUrl: "https://api.example.com" });
    expect(getConfig().publicApiUrl).toBe("https://api.example.com");
    setConfig();
  });

  it("does not tie the log retention to the statistics one", () => {
    setConfig({ statisticsLifetime: 60 * MS_PER_DAY });
    expect(getConfig().requestLogRetention).toBe(30 * MS_PER_DAY);
    setConfig({ requestLogRetention: 7 * MS_PER_DAY });
    expect(getConfig().statisticsLifetime).toBe(90 * MS_PER_DAY);
    expect(getConfig().requestLogRetention).toBe(7 * MS_PER_DAY);
    setConfig();
  });
});
