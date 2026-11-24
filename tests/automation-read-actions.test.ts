import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRequestLogActionOf } from "@/automation/get-request-log";
import { getRouteDetailActionOf } from "@/automation/get-route-detail";
import { getRouteErrorsActionOf } from "@/automation/get-route-errors";
import { getRouteStatisticsActionOf } from "@/automation/get-route-statistics";
import { listIncidentsActionOf } from "@/automation/list-incidents";
import { listRoutesActionOf } from "@/automation/list-routes";
import type {
  RequestLogFilters,
  RequestLogSample,
  RequestLogSummaryRow,
} from "@/db/models/request_log.model";
import { getRouteFacts } from "@/services/route-catalog";
import type { ErrorGroup } from "@/services/route-health";
import type { RouteTraffic } from "@/services/route-statistics";
import { routeStates } from "@/services/route-state";
import { emptyBucket, type TrafficBucket } from "@/services/traffic";
import type { TimeRange, TimeWindow } from "@/services/window";
import {
  registerRoutes,
  routeHandler,
  unregisterRoutes,
} from "./helpers/routes";

const NOW = new Date("2026-11-20T10:00:00.000Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const CTX = {
  procedureId: "p",
  runId: "r",
  nodeId: "n",
  log: () => undefined,
};
const refresh = () => Promise.resolve();

beforeAll(() => {
  registerRoutes(
    routeHandler("get", "/api/orders"),
    routeHandler("post", "/api/orders"),
    routeHandler("get", "/api/secure/data"),
    routeHandler("any", "/api/secure", {
      mode: "prefix",
      callback: function auth_session() {},
    }),
    routeHandler("get", "/api/open"),
    routeHandler("get", "/api/pages/home/pagelayout"),
  );
});

afterAll(unregisterRoutes);

function bucket(fields: Partial<TrafficBucket>): TrafficBucket {
  return { ...emptyBucket(0), ...fields };
}

describe("api.get-route-statistics", () => {
  const read: Array<{ route: unknown; window: TimeWindow }> = [];
  const traffic = (
    total: TrafficBucket,
    previous: TrafficBucket | null,
  ): RouteTraffic => ({ buckets: [total], total, previous });
  const action = (total: TrafficBucket, previous: TrafficBucket | null) =>
    getRouteStatisticsActionOf({
      refresh,
      traffic: (route, window) => {
        read.push({ route, window });
        return Promise.resolve(traffic(total, previous));
      },
    });
  const measured = bucket({
    requests: 10,
    clientErrors: 1,
    serverErrors: 1,
    timed: 4,
    totalLatency: 400,
    maxLatency: 170,
    minLatency: 50,
    durations: [50, 80, 100, 170],
  });

  it("reads a route's totals, rates and latencies, with the period before", async () => {
    const output = await action(measured, bucket({ requests: 5 })).execute(
      { route: "get /api/orders/" },
      CTX,
    );
    expect(output).toMatchObject({
      found: true,
      route: "GET /api/orders",
      requests: 10,
      clientErrors: 1,
      serverErrors: 1,
      errorRate: 20,
      averageLatencyMs: 100,
      p95Ms: 170,
      maxLatencyMs: 170,
      timedRequests: 4,
      granularity: "hour",
      previous: { requests: 5, errorRate: 0, averageLatencyMs: null },
      routePath: "/modules/api/routes?route=GET+%2Fapi%2Forders&tab=statistics",
    });
  });

  it("answers null latencies without a timed call, and no previous period without compare", async () => {
    const output = await action(bucket({ requests: 3 }), bucket({})).execute(
      { route: "GET /api/orders", compare: false },
      CTX,
    );
    expect(output).toMatchObject({
      averageLatencyMs: null,
      p95Ms: null,
      maxLatencyMs: null,
      previous: null,
    });
  });

  it("answers found false for a route no handler answers, reading no route's traffic", async () => {
    read.length = 0;
    const output = await action(bucket({}), null).execute(
      { route: "DELETE /api/orders" },
      CTX,
    );
    expect(output).toMatchObject({ found: false, route: "DELETE /api/orders" });
    expect(read[0]?.route).toBeUndefined();
  });

  it("clamps a custom range to what is still stored", async () => {
    read.length = 0;
    const output = await action(bucket({}), null).execute(
      { route: "GET /api/orders", since: "2001-01-01T00:00:00Z" },
      CTX,
    );
    expect(Date.parse(output.from)).toBeGreaterThan(
      Date.parse("2001-01-01T00:00:00Z"),
    );
    expect(read[0]?.window.granularity).toBe("day");
  });
});

function group(
  status: number,
  count: number,
  message: string | null = "boom",
): ErrorGroup {
  return { status, message, count, first: NOW, last: NOW };
}

describe("api.get-route-errors", () => {
  const groups = [
    group(500, 9, "m".repeat(400)),
    group(404, 7, "Not found"),
    group(503, 2, null),
  ];
  const action = getRouteErrorsActionOf({
    refresh,
    groups: () => Promise.resolve(groups),
  });

  it("keeps the class asked, the order read, and cuts the messages", async () => {
    const server = await action.execute(
      { route: "GET /api/orders", statusClass: "server-error" },
      CTX,
    );
    expect(server.errors.map((entry) => entry.status)).toEqual([500, 503]);
    expect(server.errors[0]?.message).toHaveLength(301);
    expect(server.errors[0]?.logsPath).toContain(`error=${"m".repeat(300)}&`);
    const client = await action.execute(
      { route: "GET /api/orders", statusClass: "client-error" },
      CTX,
    );
    expect(client.errors.map((entry) => entry.status)).toEqual([404]);
  });

  it("limits the groups and counts them before the limit", async () => {
    const output = await action.execute(
      { route: "GET /api/orders", limit: 1 },
      CTX,
    );
    expect([output.errors.length, output.totalGroups]).toEqual([1, 3]);
  });
});

function error(minutesAgo: number, uri = "/api/orders"): RequestLogSample {
  return {
    timestamp: new Date(NOW.getTime() - minutesAgo * MINUTE),
    method: "GET",
    uri,
    statusCode: 500,
    responseTimeMs: 10,
    errorMessage: "boom",
  };
}

describe("api.list-incidents", () => {
  const reads: Array<{ range: TimeRange; keys: Set<string> | null }> = [];
  let scopeReads = 0;
  const action = getRouteIncidents([
    error(200),
    error(199),
    error(5),
    error(3),
    error(30, "/api/users"),
  ]);

  function getRouteIncidents(samples: RequestLogSample[]) {
    return listIncidentsActionOf({
      refresh,
      scopeKeys: () => {
        scopeReads += 1;
        return Promise.resolve(null);
      },
      errors: (range, keys) => {
        reads.push({ range, keys });
        return Promise.resolve(
          samples.filter(
            (sample) => !keys || keys.has(`${sample.method}:${sample.uri}`),
          ),
        );
      },
      now: () => NOW,
    });
  }

  it("splits a route's 5xx on 15 quiet minutes, newest first, the last one ongoing", async () => {
    const output = await action.execute({}, CTX);
    expect(
      output.incidents.map((incident) => [incident.route, incident.ongoing]),
    ).toEqual([
      ["GET /api/orders", true],
      ["GET /api/users", false],
      ["GET /api/orders", false],
    ]);
    expect(output.total).toBe(3);
    expect(NOW.getTime() - Date.parse(output.from)).toBe(7 * DAY);
  });

  it("reads one route without the scope, only the ongoing ones, up to the limit", async () => {
    scopeReads = 0;
    reads.length = 0;
    const one = await action.execute({ route: "GET /api/users" }, CTX);
    expect(one.incidents.map((incident) => incident.route)).toEqual([
      "GET /api/users",
    ]);
    expect([scopeReads, [...(reads[0]?.keys ?? [])]]).toEqual([
      0,
      ["GET:/api/users"],
    ]);
    const ongoing = await action.execute({ ongoingOnly: true }, CTX);
    expect(ongoing.total).toBe(1);
    const limited = await action.execute({ limit: 1 }, CTX);
    expect([limited.incidents.length, limited.total]).toEqual([1, 3]);
  });

  it("reads since a date over a period, never before the log retention", async () => {
    reads.length = 0;
    await action.execute(
      { period: "last-hour", since: "2026-11-20T06:00:00Z" },
      CTX,
    );
    await action.execute({ since: "2001-01-01T00:00:00Z" }, CTX);
    expect(reads[0]?.range.from.toISOString()).toBe("2026-11-20T06:00:00.000Z");
    expect(NOW.getTime() - (reads[1]?.range.from.getTime() ?? 0)).toBe(
      30 * DAY,
    );
  });
});

describe("api.get-request-log", () => {
  const row = (id: string): RequestLogSummaryRow => ({
    _id: id,
    timestamp: NOW,
    method: "GET",
    uri: "/api/orders",
    statusCode: 200,
    responseTimeMs: 4,
    routeId: "1",
    requestId: "shared",
  });
  const queried: RequestLogFilters[] = [];
  const action = getRequestLogActionOf(() => ({
    summaryById: (id: string) =>
      Promise.resolve(id === "log-1" ? row("log-1") : undefined),
    querySummary: (filters: RequestLogFilters) => {
      queried.push(filters);
      return Promise.resolve({
        results: [row("log-3"), row("log-2")],
        nextCursor: null,
      });
    },
  }));

  it("finds a request by its log id, the route still registered", async () => {
    expect(await action.execute({ id: "log-1" }, CTX)).toMatchObject({
      found: true,
      matches: 1,
      log: {
        id: "log-1",
        route: "GET /api/orders",
        routeRegistered: true,
      },
    });
  });

  it("finds the newest of the requests sharing a request id, and counts them", async () => {
    const output = await action.execute({ requestId: "shared" }, CTX);
    expect([output.log?.id, output.matches]).toEqual(["log-3", 2]);
    expect(queried[0]).toEqual({ requestId: "shared", limit: 50 });
  });

  it("answers not found as an output, and fails without either input", async () => {
    expect(await action.execute({ id: "gone" }, CTX)).toEqual({
      found: false,
      log: null,
      matches: 0,
    });
    await expect(action.execute({}, CTX)).rejects.toThrow(/log id/);
  });
});

describe("getRouteFacts", () => {
  const models = (unauthorized: number) => ({
    logs: {
      list: () => Promise.resolve({ results: [], total: unauthorized }),
    },
    routes: { getByRoute: () => Promise.resolve(undefined) },
  });

  it("reads a guarded route as required, naming its guard", async () => {
    const facts = await getRouteFacts(models(0), "GET /api/secure/data");
    expect(facts?.auth).toMatchObject({
      status: "required",
      guards: ["auth_session"],
    });
  });

  it("reads an unguarded route that answered 401 as probable, one that did not as unknown", async () => {
    expect(
      (await getRouteFacts(models(3), "GET /api/open"))?.auth,
    ).toMatchObject({ status: "probable", unauthorized: 3 });
    expect((await getRouteFacts(models(0), "GET /api/open"))?.auth.status).toBe(
      "unknown",
    );
  });

  it("answers no facts for a ref no handler answers", async () => {
    expect(await getRouteFacts(models(0), "GET /nowhere")).toBeUndefined();
  });
});

describe("api.get-route-detail", () => {
  it("answers found false for a route no handler answers", async () => {
    const action = getRouteDetailActionOf({
      scopeKeys: () => Promise.resolve(null),
      facts: () => Promise.resolve(undefined),
      states: routeStates,
    });
    expect(await action.execute({ route: "GET /nowhere" }, CTX)).toMatchObject({
      found: false,
      route: null,
      parameters: [],
    });
  });

  it("hands on declared parameters without any example value", async () => {
    const facts = await getRouteFacts(
      {
        logs: { list: () => Promise.resolve({ results: [], total: 0 }) },
        routes: { getByRoute: () => Promise.resolve(undefined) },
      },
      "GET /api/open",
    );
    for (const parameter of facts?.parameters ?? []) {
      expect(Object.keys(parameter).sort()).toEqual([
        "in",
        "name",
        "required",
        "type",
      ]);
    }
  });
});

describe("api.list-routes", () => {
  const scopes: Array<string | undefined> = [];
  let inspected = 0;
  const action = listRoutesActionOf({
    scopeKeys: (scope) => {
      scopes.push(scope);
      return Promise.resolve(null);
    },
    stored: () => Promise.resolve([]),
    states: () =>
      Promise.resolve({
        healthWindow: { from: "", to: "", minutes: 0 },
        of: () => ({
          requests: 0,
          state: "idle" as const,
          verdict: "idle" as const,
          incident: null,
          p95Ms: null,
          firstCallAt: null,
          lastCallAt: null,
        }),
      }),
    unauthorized: () => Promise.resolve(new Map()),
    inspect: () => {
      inspected += 1;
      return undefined;
    },
  });

  it("reads the scope asked, the saved one for active", async () => {
    scopes.length = 0;
    await action.execute({}, CTX);
    await action.execute({ scope: "active" }, CTX);
    await action.execute({ scope: "own" }, CTX);
    expect(scopes).toEqual([undefined, undefined, "own"]);
  });

  it("pages by offset, lists no page layout, and inspects no handler without includeAuth", async () => {
    inspected = 0;
    const first = await action.execute({ pathPrefix: "/api", limit: 2 }, CTX);
    const routes = [
      ...first.routes,
      ...(
        await action.execute(
          { pathPrefix: "/api", limit: 2, offset: first.nextOffset ?? 0 },
          CTX,
        )
      ).routes,
    ].map((entry) => entry.route);
    expect(first.total).toBe(4);
    expect(first.nextOffset).toBe(2);
    expect(routes).toEqual([
      "GET /api/open",
      "GET /api/orders",
      "POST /api/orders",
      "GET /api/secure/data",
    ]);
    expect(first.routes[0]?.authStatus).toBeNull();
    expect(inspected).toBe(0);
    await action.execute({ includeAuth: true, limit: 1 }, CTX);
    expect(inspected).toBe(1);
  });
});
