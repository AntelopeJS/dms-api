import { internal } from "@antelopejs/interface-dms-automation";
import { describe, expect, it } from "vitest";
import {
  API_ACTIONS,
  API_DATA_NODES,
  API_TRIGGERS,
  isMissingAutomationInterface,
  registerAutomationNodes,
  unregisterAutomationNodes,
} from "@/automation";
import { healthOutput } from "@/automation/health-output";
import { requestSummary, truncateMessage } from "@/automation/outputs";
import { requestLogFilters } from "@/automation/query-request-logs";
import type { RequestLogSummaryRow } from "@/db/models/request_log.model";
import { queryRequestSummariesScoped } from "@/services/request-log/read";
import type { HealthPayload } from "@/services/overview";

const WRITES = new Set(["api.call-route"]);

/** The ids registered with the automation interface while `run` runs. */
async function registeredDuring(
  run: (registered: Set<string>) => Promise<void>,
): Promise<void> {
  const registered = new Set<string>();
  const leases = [
    internal.RegisterTriggerType,
    internal.RegisterActionType,
    internal.RegisterDataNodeType,
  ].map(
    (proxy) =>
      [
        proxy,
        proxy.onHandlers(
          (id: string) => {
            if (id.startsWith("api.")) registered.add(id);
          },
          (id: string) => registered.delete(id),
          true,
        ),
      ] as const,
  );
  try {
    await run(registered);
  } finally {
    for (const [proxy, lease] of leases) proxy.detach(lease);
  }
}

describe("the registration", () => {
  it("declares every node once in start() and withdraws each in stop()", async () => {
    await registeredDuring(async (registered) => {
      await registerAutomationNodes();
      await registerAutomationNodes();
      expect([...registered].sort()).toEqual(
        [
          "api.route-unhealthy",
          "api.health-changed",
          "api.route-recovered",
          "api.request-captured",
          "api.route-registered",
          "api.query-request-logs",
          "api.get-api-health",
          "api.call-route",
          "api.list-unhealthy-routes",
          "api.list-incidents",
          "api.get-route-statistics",
          "api.get-route-errors",
          "api.get-request-log",
          "api.get-route-detail",
          "api.list-routes",
          "api.console-link",
        ].sort(),
      );
      await unregisterAutomationNodes();
      expect(registered.size).toBe(0);
      await registerAutomationNodes();
      expect(registered.size).toBe(16);
      await unregisterAutomationNodes();
    });
  });

  it("reads a missing interface package as no automation, any other load error as a failure", () => {
    const missing = Object.assign(
      new Error(
        "Cannot find module '@antelopejs/interface-dms-automation'\nRequire stack:",
      ),
      { code: "MODULE_NOT_FOUND" },
    );
    const nested = Object.assign(
      new Error("Cannot find module 'left-pad'\nRequire stack:"),
      { code: "MODULE_NOT_FOUND" },
    );
    expect(isMissingAutomationInterface(missing)).toBe(true);
    expect(isMissingAutomationInterface(nested)).toBe(false);
  });
});

describe("the node declarations", () => {
  it("declares every read without side effects and the write with a dry run", () => {
    for (const action of API_ACTIONS) {
      expect(
        [action.sideEffects, Object.hasOwn(action, "dryRun")],
        action.id,
      ).toEqual(WRITES.has(action.id) ? [undefined, true] : [false, false]);
    }
  });

  it("gives every trigger a cluster mode and a deliveryId output", () => {
    for (const trigger of API_TRIGGERS) {
      expect(["singleton", "replicated"], trigger.id).toContain(
        trigger.cluster,
      );
      expect(
        trigger.outputSchema.properties?.deliveryId,
        trigger.id,
      ).toMatchObject({ type: "string" });
    }
    const captured = API_TRIGGERS.find(
      (trigger) => trigger.id === "api.request-captured",
    );
    expect(captured?.cluster).toBe("replicated");
  });

  it("closes every input and config schema", () => {
    for (const node of [...API_ACTIONS, ...API_DATA_NODES]) {
      expect(node.inputSchema.additionalProperties, node.id).toBe(false);
    }
    for (const trigger of API_TRIGGERS) {
      expect(trigger.configSchema.additionalProperties, trigger.id).toBe(false);
    }
  });

  it("bounds the health breakdown to the longest statistics retention", () => {
    const health = API_ACTIONS.find(
      (action) => action.id === "api.get-api-health",
    );
    expect(health?.inputSchema.properties?.days).toMatchObject({
      type: "integer",
      minimum: 1,
      maximum: 90,
    });
  });

  it("keeps the KPI outputs of the health action and adds the verdict", () => {
    const health = API_ACTIONS.find(
      (action) => action.id === "api.get-api-health",
    );
    expect(Object.keys(health?.outputSchema.properties ?? {})).toEqual([
      "totalRoutes",
      "failingRoutes",
      "slowRoutesCount",
      "averageLatencyMs",
      "callsToday",
      "errors24h",
      "statusBreakdown",
      "verdict",
      "verdictSince",
      "incidentStart",
      "incidentEnd",
      "durationMs",
      "serverErrorRate",
      "clientErrorRate",
      "p95Ms",
      "requestsPerMinute",
      "calls24h",
      "serverErrors24h",
      "recoveredRoutes",
      "routesNeedingAttention",
      "scope",
      "logsPath",
      "checkedAt",
    ]);
  });
});

function payload(fields: Partial<HealthPayload> = {}): HealthPayload {
  return {
    verdict: "degraded",
    incidentStart: "2026-11-20T09:40:00.000Z",
    incidentEnd: null,
    durationMs: 20 * 60_000,
    checkedAt: "2026-11-20T10:00:03.000Z",
    metrics: {
      serverErrorRate: 4.5,
      clientErrorRate: 1.25,
      p95Ms: 310,
      requestsPerMinute: 12.4,
      requests: 186,
    },
    metricsWindow: { from: "", to: "" },
    ruleWindows: null,
    thresholds: {
      degradedServerErrorRate: 1,
      downServerErrorRate: 20,
      windowMinutes: 15,
      downWindowMinutes: 5,
      minRequests: 20,
      recoveryMinutes: 15,
      lookbackMinutes: 1440,
      clientErrorRate: 5,
      slowCallRate: 5,
      slowThresholdMs: 1000,
    },
    healthWindow: {
      from: "2026-11-19T10:00:00.000Z",
      to: "2026-11-20T10:00:00.000Z",
      minutes: 1440,
    },
    failingRoutes: 2,
    recoveredRoutes: 1,
    slowRoutes: 0,
    serverErrors: 40,
    calls: { value: 4000, delta: 3 },
    errors: { value: 60, share: 1.5, serverShare: 1, clientShare: 0.5 },
    latency: { value: 80, max: 900, p95: 300 },
    routes: { value: 12, needingAttention: 3 },
    serverErrorsLink: "/modules/api/logs?requests.tab=5xx",
    firstRun: false,
    ...fields,
  };
}

describe("healthOutput", () => {
  it("maps the Overview's health, since when the verdict holds, and the incident's 5xx", () => {
    expect(healthOutput(payload(), "own")).toEqual({
      verdict: "degraded",
      verdictSince: "2026-11-20T09:40:00.000Z",
      incidentStart: "2026-11-20T09:40:00.000Z",
      incidentEnd: null,
      durationMs: 1_200_000,
      serverErrorRate: 4.5,
      clientErrorRate: 1.25,
      p95Ms: 310,
      requestsPerMinute: 12.4,
      calls24h: 4000,
      serverErrors24h: 40,
      recoveredRoutes: 1,
      routesNeedingAttention: 3,
      scope: "own",
      logsPath:
        "/modules/api/logs?since=2026-11-20T09%3A40%3A00.000Z&requests.tab=5xx",
      checkedAt: "2026-11-20T10:00:03.000Z",
    });
  });

  it("keeps the nulls of a verdict older than the lookback, and links the last 24 h of 5xx without an incident", () => {
    const output = healthOutput(
      payload({
        verdict: "operational",
        incidentStart: null,
        durationMs: null,
        metrics: {
          serverErrorRate: 0,
          clientErrorRate: 0,
          p95Ms: null,
          requestsPerMinute: 0,
          requests: 0,
        },
      }),
      "all",
    );
    expect(output).toMatchObject({
      verdictSince: null,
      incidentStart: null,
      durationMs: null,
      p95Ms: null,
      logsPath:
        "/modules/api/logs?api.period=last-24h&from=overview&requests.tab=5xx",
    });
  });
});

const ROW: RequestLogSummaryRow = {
  _id: "log-1",
  timestamp: new Date("2026-11-20T10:00:00.000Z"),
  method: "HEAD",
  uri: "/api/orders/:id",
  statusCode: 500,
  responseTimeMs: null,
  routeId: "7",
  routeMethod: "GET",
  source: undefined,
  requestId: "abc",
  errorMessage: "x".repeat(400),
};

describe("requestSummary", () => {
  it("hands on a stored request without the client, headers, bodies or stack", () => {
    const stored = {
      ...ROW,
      ip: "10.0.0.1",
      userAgent: "curl",
      rawPath: "/api/orders/42",
      requestHeaders: { cookie: "s" },
      requestBody: "{}",
      responseBody: "{}",
      error: { message: "boom", stack: "at x" },
      query: { q: "1" },
      pathParams: { id: "42" },
    };
    const summary = requestSummary(stored);
    expect(Object.keys(summary).sort()).toEqual(
      [
        "consolePath",
        "errorMessage",
        "id",
        "method",
        "requestId",
        "responseTimeMs",
        "route",
        "routeMethod",
        "source",
        "statusCode",
        "timestamp",
        "uri",
      ].sort(),
    );
    expect(summary).toMatchObject({
      id: "log-1",
      timestamp: "2026-11-20T10:00:00.000Z",
      route: "GET /api/orders/:id",
      routeMethod: "GET",
      source: null,
      consolePath: "/modules/api/logs?record=log-1",
    });
    expect(JSON.stringify(summary)).not.toMatch(/10\.0\.0\.1|curl|at x|42/);
  });

  it("cuts an error message at 300 characters and names no route for an unmatched path", () => {
    const summary = requestSummary({ ...ROW, routeId: undefined });
    expect(summary.errorMessage).toBe(`${"x".repeat(300)}…`);
    expect(summary.route).toBeNull();
    expect(truncateMessage("short")).toBe("short");
    expect(truncateMessage(undefined)).toBeNull();
  });
});

describe("the query of api.query-request-logs", () => {
  it("refuses a page over 200 rows and reads 50 by default", () => {
    const logs = API_ACTIONS.find(
      (action) => action.id === "api.query-request-logs",
    );
    expect(logs?.inputSchema.properties?.limit).toMatchObject({
      maximum: 200,
      default: 50,
    });
    expect(requestLogFilters({}).limit).toBe(50);
  });

  it("answers an empty scope with no rows, without a query", async () => {
    let queried = 0;
    const model = {
      querySummary: () => {
        queried += 1;
        return Promise.resolve({ results: [], nextCursor: null });
      },
    };
    expect(
      await queryRequestSummariesScoped(model, { limit: 10 }, new Set()),
    ).toEqual({ results: [], nextCursor: null });
    expect(queried).toBe(0);
  });

  it("passes the cursor on, so a second call reads the next page", () => {
    expect(requestLogFilters({ cursor: "c1", limit: 10 })).toEqual({
      cursor: "c1",
      limit: 10,
    });
  });

  it("filters on a route ref by its method and canonical path, leaving unset filters out", () => {
    expect(
      requestLogFilters({
        route: "post /api/orders/",
        since: "2026-11-20T00:00:00Z",
      }),
    ).toEqual({
      routeMethod: "POST",
      uri: "/api/orders",
      since: new Date("2026-11-20T00:00:00Z"),
      limit: 50,
    });
  });

  it("fails on a malformed route ref or date", () => {
    expect(() => requestLogFilters({ route: "/api/orders" })).toThrow(
      /METHOD \/path/,
    );
    expect(() => requestLogFilters({ until: "yesterday" })).toThrow(/until/);
  });
});
