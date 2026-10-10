import { describe, expect, it } from "vitest";
import type { RequestLogSample } from "@/db/models/request_log.model";
import {
  computeRouteHealth,
  issueOf,
  routesNeedingAttention,
} from "@/services/route-health";

const at = new Date("2026-10-07T12:00:00.000Z");

function sample(
  method: string,
  uri: string,
  statusCode: number,
  responseTimeMs = 50,
  errorMessage?: string,
): RequestLogSample {
  return {
    timestamp: at,
    method,
    uri,
    statusCode,
    responseTimeMs,
    errorMessage,
  };
}

function repeat(count: number, make: () => RequestLogSample) {
  return Array.from({ length: count }, make);
}

describe("issueOf", () => {
  const traffic = (requests: number, client = 0, server = 0, latency = 50) => ({
    start: 0,
    requests,
    clientErrors: client,
    serverErrors: server,
    totalLatency: latency * requests,
    maxLatency: latency,
    minLatency: latency,
  });

  it("calls a route with any 5xx failing, whatever else it does", () => {
    expect(issueOf(traffic(100, 50, 1, 5000), 1000)).toBe("failing");
  });

  it("calls a route slow on its average, not on one slow call", () => {
    expect(issueOf(traffic(10, 0, 0, 1200), 1000)).toBe("slow");
    expect(issueOf(traffic(10, 0, 0, 900), 1000)).toBeNull();
  });

  it("flags client errors from 5 % of the calls", () => {
    expect(issueOf(traffic(100, 5), 1000)).toBe("client-errors");
    expect(issueOf(traffic(100, 4), 1000)).toBeNull();
  });

  it("has nothing to say about a route nobody called", () => {
    expect(issueOf(traffic(0), 1000)).toBeNull();
  });
});

describe("computeRouteHealth", () => {
  it("groups errors by status and message, the most frequent first", () => {
    const health = computeRouteHealth(
      [
        ...repeat(3, () => sample("post", "/orders", 422, 50, "Out of stock")),
        sample("POST", "/orders", 400, 50, "Cart is empty"),
        sample("POST", "/orders", 201),
      ],
      1000,
    );
    const route = health.get("POST:/orders");
    expect(route?.traffic.requests).toBe(5);
    expect(route?.errors.map((group) => [group.status, group.count])).toEqual([
      [422, 3],
      [400, 1],
    ]);
    expect(route?.issue).toBe("client-errors");
  });
});

describe("routesNeedingAttention", () => {
  it("lists failing routes first, then slow ones, then client errors", () => {
    const health = computeRouteHealth(
      [
        ...repeat(10, () => sample("GET", "/slow", 200, 2000)),
        ...repeat(10, () => sample("GET", "/client", 404)),
        sample("POST", "/hook", 500, 20, "TypeError"),
        ...repeat(10, () => sample("GET", "/fine", 200)),
      ],
      1000,
    );
    expect(
      routesNeedingAttention(health.values()).map((route) => route.uri),
    ).toEqual(["/hook", "/slow", "/client"]);
  });
});
