import { describe, expect, it } from "vitest";
import { healthBanner, healthStats } from "@/services/health-blocks";
import { HEALTH_THRESHOLDS } from "@/services/health-rules";
import type { HealthPayload } from "@/services/overview";

const ERRORS_LINK = "/modules/api/logs?requests.tab=5xx";

function health(overrides: Partial<HealthPayload> = {}): HealthPayload {
  return {
    verdict: "operational",
    incidentStart: null,
    incidentEnd: null,
    durationMs: null,
    checkedAt: "2026-10-11T12:00:00.000Z",
    metrics: {
      serverErrorRate: 0,
      clientErrorRate: 2.5,
      p95Ms: 120,
      requestsPerMinute: 27,
      requests: 405,
    },
    metricsWindow: {
      from: "2026-10-11T11:45:00.000Z",
      to: "2026-10-11T12:00:00.000Z",
    },
    ruleWindows: null,
    thresholds: { ...HEALTH_THRESHOLDS, slowThresholdMs: 1000 },
    healthWindow: {
      from: "2026-10-10T12:00:00.000Z",
      to: "2026-10-11T12:00:00.000Z",
      minutes: HEALTH_THRESHOLDS.lookbackMinutes,
    },
    failingRoutes: 0,
    recoveredRoutes: 0,
    slowRoutes: 0,
    serverErrors: 0,
    calls: { value: 405 },
    errors: { value: 10, share: 2.5, serverShare: 0, clientShare: 2.5 },
    latency: { value: 80, max: 300, p95: 120 },
    routes: { value: 15, needingAttention: 0 },
    serverErrorsLink: ERRORS_LINK,
    firstRun: false,
    ...overrides,
  };
}

describe("healthBanner", () => {
  it("says the API is healthy, with no route above the thresholds", () => {
    expect(healthBanner(health())).toEqual({
      tone: "success",
      icon: "i-ph-check-circle",
      title: "$api.health.verdict.operational",
      description: {
        key: "api.health.reasons.none",
        params: { minutes: { type: "number", value: 15 } },
      },
      actions: [],
    });
  });

  it("dates a degraded verdict and says why, the server errors a click away", () => {
    const banner = healthBanner(
      health({
        verdict: "degraded",
        incidentStart: "2026-10-11T11:52:00.000Z",
        failingRoutes: 1,
        slowRoutes: 2,
        serverErrors: 13,
      }),
    );
    expect(banner.tone).toBe("warning");
    expect(banner.title).toEqual({
      key: "api.health.since_degraded",
      params: {
        date: {
          type: "datetime",
          value: "2026-10-11T11:52:00.000Z",
          format: "day",
        },
      },
    });
    expect(banner.description).toMatchObject({
      key: "api.health.reasons.join",
      params: {
        first: {
          key: "api.health.reasons.failing",
          params: { count: { type: "count", value: 1 } },
        },
        rest: { key: "api.health.reasons.slow" },
      },
    });
    expect(banner.actions).toEqual([
      expect.objectContaining({
        label: "$api.health.view_server_errors",
        to: ERRORS_LINK,
      }),
    ]);
  });

  it("dates a recovered verdict from the end of its incident", () => {
    const banner = healthBanner(
      health({
        verdict: "recovered",
        incidentStart: "2026-10-11T11:00:00.000Z",
        incidentEnd: "2026-10-11T11:40:00.000Z",
        recoveredRoutes: 1,
      }),
    );
    expect(banner.title).toMatchObject({
      key: "api.health.since_recovered",
      params: { date: { value: "2026-10-11T11:40:00.000Z" } },
    });
  });

  it("guides the first run to the routes and the logs", () => {
    const banner = healthBanner(health({ firstRun: true }));
    expect(banner.tone).toBe("primary");
    expect(banner.actions?.map((action) => action.label)).toEqual([
      "$api.health.first_run.browse",
      "$api.health.first_run.logs",
    ]);
  });
});

describe("healthStats", () => {
  it("gives the four figures of the rules' window, composed for the reader", () => {
    const { items } = healthStats(
      health({
        metrics: {
          serverErrorRate: 3.3,
          clientErrorRate: 10.3,
          p95Ms: 1296,
          requestsPerMinute: 27,
          requests: 405,
        },
      }),
    );
    expect(items.map((item) => item.id)).toEqual([
      "server_errors",
      "p95",
      "traffic",
      "client_errors",
    ]);
    const [errors, p95] = items;
    expect(errors).toMatchObject({
      tone: "error",
      value: {
        key: "api.common.percent",
        params: { value: { type: "number", value: 3.3 } },
      },
      to: ERRORS_LINK,
    });
    expect(p95).toMatchObject({
      tone: "warning",
      value: {
        key: "api.common.ms",
        params: { value: { type: "number", value: 1296 } },
      },
    });
  });

  it("writes a dash for a p95 nothing measured", () => {
    const { items } = healthStats(
      health({
        metrics: {
          serverErrorRate: 0,
          clientErrorRate: 0,
          p95Ms: null,
          requestsPerMinute: 0,
          requests: 0,
        },
      }),
    );
    expect(items[1]).toMatchObject({ value: "—", tone: "muted" });
  });
});
