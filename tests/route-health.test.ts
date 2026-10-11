import { describe, expect, it } from "vitest";
import type { RequestLogSample } from "@/db/models/request_log.model";
import { evaluateHealth } from "@/services/health-rules";
import {
  computeRouteHealth,
  evaluateRoutes,
  issueOf,
  routesNeedingAttention,
} from "@/services/route-health";
import { addSample, emptyBucket } from "@/services/traffic";
import { MS_PER_DAY, MS_PER_MINUTE } from "@/types";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const LOOKBACK = { from: new Date(NOW.getTime() - MS_PER_DAY), to: NOW };
const SLOW_MS = 1000;

/** `minutesAgo` minutes before NOW. */
function ago(minutesAgo: number): Date {
  return new Date(NOW.getTime() - minutesAgo * MS_PER_MINUTE);
}

function sample(
  uri: string,
  statusCode: number,
  timestamp: Date = ago(1),
  responseTimeMs: number | null = 50,
  {
    errorMessage,
    method = "GET",
  }: { errorMessage?: string; method?: string } = {},
): RequestLogSample {
  return {
    timestamp,
    method,
    uri,
    statusCode,
    responseTimeMs: responseTimeMs as number,
    errorMessage,
  };
}

/** `count` calls spread one per `every` minutes, the newest `from` minutes ago. */
function steady(
  uri: string,
  count: number,
  from: number,
  every = 1,
  { statusCode = 200, responseTimeMs = 50 } = {},
): RequestLogSample[] {
  return Array.from({ length: count }, (_, index) =>
    sample(uri, statusCode, ago(from + index * every), responseTimeMs),
  );
}

describe("evaluateHealth", () => {
  it("is idle without a call and operational on clean traffic", () => {
    expect(evaluateHealth([], LOOKBACK, SLOW_MS, true).verdict).toBe("idle");
    expect(
      evaluateHealth(steady("/a", 100, 0), LOOKBACK, SLOW_MS, true).verdict,
    ).toBe("operational");
  });

  it("shrugs off one 500 among thousands of calls", () => {
    const samples = [
      ...steady("/a", 2000, 0, 0.005),
      sample("/a", 500, ago(3)),
    ];
    expect(evaluateHealth(samples, LOOKBACK, SLOW_MS, true).verdict).toBe(
      "operational",
    );
  });

  it("is degraded from 1 % of 5xx, since the first of them", () => {
    const samples = [
      ...steady("/a", 300, 0, 0.1),
      sample("/a", 500, ago(10)),
      sample("/a", 500, ago(5)),
      sample("/a", 500, ago(2)),
    ];
    const health = evaluateHealth(samples, LOOKBACK, SLOW_MS, true);
    expect(health.verdict).toBe("degraded");
    expect(health.incident?.start).toEqual(ago(10));
    expect(health.incident?.end).toBeNull();
    expect(health.durationMs).toBe(10 * MS_PER_MINUTE);
  });

  it("is down from 20 % of 5xx over the last 5 minutes", () => {
    const samples = [
      ...steady("/a", 40, 0, 0.1),
      ...steady("/a", 20, 0, 0.2, { statusCode: 500 }),
    ];
    expect(evaluateHealth(samples, LOOKBACK, SLOW_MS, true).verdict).toBe(
      "down",
    );
  });

  it("recovers for 15 minutes once the errors stop, then is operational", () => {
    const burst = (minutesAgo: number) => [
      ...steady("/a", 600, 0, 0.1),
      ...steady("/a", 10, minutesAgo, 0.1, { statusCode: 500 }),
    ];
    // The burst leaves the 15-minute window 15 minutes after it ended.
    const recovered = evaluateHealth(burst(20), LOOKBACK, SLOW_MS, true);
    expect(recovered.verdict).toBe("recovered");
    expect(recovered.incident?.end).not.toBeNull();
    expect(evaluateHealth(burst(45), LOOKBACK, SLOW_MS, true).verdict).toBe(
      "operational",
    );
  });

  it("is degraded when the p95 reaches the slow threshold", () => {
    const samples = [
      ...steady("/a", 90, 0, 0.1),
      ...steady("/a", 10, 0, 0.1, { responseTimeMs: 1500 }),
    ];
    expect(evaluateHealth(samples, LOOKBACK, SLOW_MS, true).verdict).toBe(
      "degraded",
    );
    expect(evaluateHealth(samples, LOOKBACK, SLOW_MS, false).verdict).toBe(
      "operational",
    );
  });

  it("never reads a rate off fewer calls than the minimum", () => {
    const samples = [sample("/a", 500, ago(1)), sample("/a", 200, ago(2))];
    expect(evaluateHealth(samples, LOOKBACK, SLOW_MS, true).verdict).toBe(
      "operational",
    );
  });
});

describe("issueOf", () => {
  const traffic = (requests: number, client = 0, server = 0) => {
    const bucket = emptyBucket(0);
    for (let index = 0; index < requests; index++) {
      const status = index < server ? 500 : index < server + client ? 404 : 200;
      addSample(bucket, { statusCode: status, responseTimeMs: 50 });
    }
    return bucket;
  };

  it("calls a route failing from 1 % of 5xx over enough calls", () => {
    expect(issueOf(traffic(100, 0, 1), SLOW_MS)).toBe("failing");
    expect(issueOf(traffic(10, 0, 5), SLOW_MS)).toBeNull();
  });

  it("flags client errors from 5 % of the calls", () => {
    expect(issueOf(traffic(100, 5), SLOW_MS)).toBe("client-errors");
    expect(issueOf(traffic(100, 4), SLOW_MS)).toBeNull();
  });
});

describe("computeRouteHealth", () => {
  it("groups errors by status and message, the most frequent first", () => {
    const health = computeRouteHealth(
      [
        ...Array.from({ length: 3 }, () =>
          sample("/orders", 422, ago(1), 50, {
            errorMessage: "Out of stock",
            method: "post",
          }),
        ),
        sample("/orders", 400, ago(1), 50, {
          errorMessage: "Cart is empty",
          method: "POST",
        }),
        sample("/orders", 201, ago(1), 50, { method: "POST" }),
      ],
      SLOW_MS,
    );
    const route = health.get("POST:/orders");
    expect(route?.traffic.requests).toBe(5);
    expect(route?.errors.map((group) => [group.status, group.count])).toEqual([
      [422, 3],
      [400, 1],
    ]);
  });

  it("counts an unmeasured call without a 0 ms duration", () => {
    const route = computeRouteHealth(
      [sample("/a", 200, ago(1), 100), sample("/a", 500, ago(1), null)],
      SLOW_MS,
    ).get("GET:/a");
    expect(route?.traffic.requests).toBe(2);
    expect(route?.traffic.timed).toBe(1);
    expect(route?.traffic.minLatency).toBe(100);
  });
});

describe("evaluateRoutes and routesNeedingAttention", () => {
  it("lists failing, recovered, slow then client-error routes, healthy ones out", () => {
    const samples = [
      ...steady("/hook", 100, 0, 0.1),
      ...steady("/hook", 5, 0, 0.5, { statusCode: 500 }),
      ...steady("/old", 300, 0, 0.1),
      ...steady("/old", 5, 20, 0.5, { statusCode: 500 }),
      ...steady("/slow", 30, 0, 1, { responseTimeMs: 2000 }),
      ...steady("/client", 30, 0, 1, { statusCode: 404 }),
      ...steady("/fine", 30, 0, 1),
      sample("/rare", 404, ago(1)),
    ];
    const routes = evaluateRoutes(samples, LOOKBACK, SLOW_MS);
    expect(routes.get("GET:/old")?.state).toBe("recovered");
    expect(routes.get("GET:/fine")?.state).toBe("healthy");
    // One call is no volume: 100 % of 4xx on it is not a finding.
    expect(routes.get("GET:/rare")?.state).toBe("healthy");
    expect(
      routesNeedingAttention(routes.values()).map((route) => route.uri),
    ).toEqual(["/hook", "/old", "/slow", "/client"]);
  });
});

describe("a route called a few times an hour", () => {
  /**
   * One call every 20 minutes over the day, a burst of 60 × 500 ending
   * `quietMinutes` ago, then the same trickle of 2xx: the window reaches
   * back hours for its 20 calls and holds the burst all along.
   */
  function trickleAfterBurst(quietMinutes: number): RequestLogSample[] {
    return [
      ...steady("/refund", 70, 0, 20),
      ...Array.from({ length: 60 }, (_, index) =>
        sample("/refund", 500, ago(quietMinutes + index * 0.01)),
      ),
    ];
  }

  it("is recovered 15 minutes after its last 5xx, then healthy, like the API", () => {
    const failing = evaluateRoutes(trickleAfterBurst(10), LOOKBACK, SLOW_MS);
    expect(failing.get("GET:/refund")?.state).toBe("failing");

    const recovered = evaluateRoutes(trickleAfterBurst(20), LOOKBACK, SLOW_MS);
    const route = recovered.get("GET:/refund");
    expect(route?.state).toBe("recovered");
    expect(route?.verdict).toBe("recovered");
    // Back the minute the last 5xx left the 15-minute span.
    expect(route?.incident?.end).toEqual(ago(20 - 15));

    const healthy = evaluateRoutes(trickleAfterBurst(35), LOOKBACK, SLOW_MS);
    expect(healthy.get("GET:/refund")?.state).toBe("healthy");
    expect(healthy.get("GET:/refund")?.incident?.end).toEqual(ago(35 - 15));
  });

  it("gives the windows its verdict was read over", () => {
    const route = evaluateRoutes(trickleAfterBurst(3), LOOKBACK, SLOW_MS).get(
      "GET:/refund",
    );
    expect(route?.verdict).toBe("down");
    const windows = route?.windows;
    expect(windows?.down.to).toEqual(NOW);
    expect(windows?.down.serverErrors).toBe(60);
    // Under 20 calls in 5 minutes: both windows reach back for volume.
    expect(windows?.down.requests).toBeGreaterThanOrEqual(20);
    expect(windows?.degraded.from.getTime()).toBeLessThanOrEqual(
      windows?.down.from.getTime() ?? 0,
    );
  });
});
