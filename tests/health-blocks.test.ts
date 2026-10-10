import { describe, expect, it } from "vitest";
import { healthBanner, healthStats } from "@/services/health-blocks";
import type { HealthPayload } from "@/services/overview";

const health: HealthPayload = {
  verdict: "degraded",
  since: "2026-10-09T14:02:00.000Z",
  checkedAt: "2026-10-10T08:00:00.000Z",
  failingRoutes: 1,
  slowRoutes: 2,
  serverErrors: 8,
  calls: { value: 1762, delta: null },
  errors: { value: 183, share: 10.4 },
  latency: { value: 188, max: 2288 },
  routes: { value: 17, needingAttention: 3 },
  serverErrorsLink: "/modules/api/logs?requests.tab=5xx",
  firstRun: false,
};

describe("health blocks", () => {
  it("tones the banner by the verdict and gives its reasons", () => {
    const banner = healthBanner(health);
    expect(banner.tone).toBe("warning");
    expect(banner.title).toMatchObject({ key: "api.health.title_since" });
    expect(banner.description).toMatchObject({
      key: "api.health.reasons.both",
    });
    expect(banner.actions).toEqual([
      expect.objectContaining({ to: health.serverErrorsLink }),
    ]);
  });

  it("guides the first run instead of a verdict", () => {
    const banner = healthBanner({ ...health, firstRun: true });
    expect(banner.tone).toBe("primary");
    expect(banner.actions).toHaveLength(2);
    expect(healthStats({ ...health, firstRun: true }).items).toEqual([]);
  });

  it("offers no action without server errors", () => {
    const banner = healthBanner({
      ...health,
      verdict: "operational",
      failingRoutes: 0,
      slowRoutes: 0,
      serverErrors: 0,
    });
    expect(banner.tone).toBe("success");
    expect(banner.description).toEqual({ key: "api.health.reasons.none" });
    expect(banner.actions).toEqual([]);
  });

  it("writes the four headline figures", () => {
    const items = healthStats(health).items;
    expect(items.map((item) => item.id)).toEqual([
      "calls",
      "errors",
      "latency",
      "routes",
    ]);
    expect(items[1]?.detailTone).toBe("error");
    expect(items[3]?.detailTone).toBe("warning");
  });
});
