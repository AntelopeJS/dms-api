import { describe, expect, it } from "vitest";
import { consoleLink, setDashboardOrigin } from "@/automation/console-link";
import { requestLogAnswer } from "@/automation/get-request-log";
import { errorGroupOutput } from "@/automation/get-route-errors";
import { incidentOutput, readRange } from "@/automation/list-incidents";
import { filterRoutes } from "@/automation/list-routes";
import { unhealthyRoutes } from "@/automation/list-unhealthy-routes";
import { findIncidents } from "@/services/activity";
import type { RouteRow } from "@/services/route-catalog";
import type { RouteHealthState } from "@/services/route-health";
import { emptyBucket } from "@/services/traffic";
import type { TimeWindow } from "@/services/window";

const NOW = new Date("2026-11-20T10:00:00.000Z");
const MINUTE = 60_000;

function route(
  key: string,
  state: RouteHealthState["state"],
  fields: Partial<RouteHealthState> = {},
): RouteHealthState {
  const [method, uri] = key.split(":");
  return {
    key,
    method,
    uri,
    traffic: { ...emptyBucket(0), requests: 100, serverErrors: 10 },
    issue: null,
    errors: [],
    state,
    verdict: state === "failing" ? "degraded" : "operational",
    incident: null,
    durationMs: null,
    windows: null,
    p95Ms: null,
    lastCall: NOW,
    ...fields,
  };
}

describe("unhealthyRoutes", () => {
  const routes = [
    route("GET:/warn", "client-errors"),
    route("GET:/slow", "slow", { p95Ms: 2000 }),
    route("GET:/recovered", "recovered"),
    route("GET:/degraded", "failing"),
    route("GET:/down", "failing", {
      verdict: "down",
      errors: [
        {
          status: 503,
          message: "m".repeat(320),
          count: 7,
          first: NOW,
          last: NOW,
        },
      ],
    }),
    route("GET:/healthy", "healthy"),
  ];

  it("lists the worst first: down, degraded, slow, warn; recovered only when asked", () => {
    expect(unhealthyRoutes(routes, {}).map((entry) => entry.uri)).toEqual([
      "/down",
      "/degraded",
      "/slow",
      "/warn",
    ]);
    expect(
      unhealthyRoutes(routes, { includeRecovered: true }).map(
        (entry) => entry.uri,
      ),
    ).toEqual(["/down", "/degraded", "/recovered", "/slow", "/warn"]);
  });

  it("keeps the flags asked, and hands on the top error cut at 300 characters", () => {
    const [down] = unhealthyRoutes(routes, { flags: ["broken"] });
    expect(
      unhealthyRoutes(routes, { flags: ["broken"] }).map((entry) => entry.flag),
    ).toEqual(["broken", "broken"]);
    expect(down).toMatchObject({
      route: "GET /down",
      verdict: "down",
      topErrorStatus: 503,
      topErrorCount: 7,
      errorRate: 0.1,
      routePath: "/modules/api/routes?route=GET+%2Fdown",
    });
    expect(down.topErrorMessage).toHaveLength(301);
  });
});

describe("api.list-incidents", () => {
  it("reads a period up to now, or since a date, never before the log retention", () => {
    const week = readRange({}, "last-7-days", NOW);
    expect(NOW.getTime() - week.from.getTime()).toBe(7 * 24 * 60 * MINUTE);
    const custom = readRange(
      { since: "2026-11-20T08:00:00Z", until: "2026-11-20T09:00:00Z" },
      "last-7-days",
      NOW,
    );
    expect([custom.from.toISOString(), custom.to.toISOString()]).toEqual([
      "2026-11-20T08:00:00.000Z",
      "2026-11-20T09:00:00.000Z",
    ]);
    const old = readRange({ since: "2020-01-01T00:00:00Z" }, "last-24h", NOW);
    expect(NOW.getTime() - old.from.getTime()).toBe(30 * 24 * 60 * MINUTE);
  });

  it("hands each incident on with its top error and its 5xx in the logs", () => {
    const sample = (minutesAgo: number) => ({
      timestamp: new Date(NOW.getTime() - minutesAgo * MINUTE),
      method: "POST",
      uri: "/hook",
      statusCode: 500,
      responseTimeMs: 10,
      errorMessage: "boom",
    });
    const incidents = findIncidents(
      [sample(100), sample(99), sample(5)],
      NOW.getTime(),
    ).map(incidentOutput);
    expect(incidents).toHaveLength(2);
    expect(incidents[0]).toMatchObject({
      route: "POST /hook",
      ongoing: true,
      serverErrors: 1,
      topErrorStatus: 500,
      topErrorMessage: "boom",
    });
    expect(incidents[1].logsPath).toBe(
      "/modules/api/logs?route=POST+%2Fhook&since=2026-11-20T08%3A20%3A00.000Z&until=2026-11-20T08%3A21%3A00.001Z&requests.tab=5xx",
    );
  });
});

describe("api.get-route-errors", () => {
  it("links each group to its requests over the read's period or range", () => {
    const group = {
      status: 404,
      message: "Not found",
      count: 3,
      first: NOW,
      last: NOW,
    };
    const preset = {
      from: NOW,
      to: NOW,
      preset: "last-24h",
    } as const satisfies Partial<TimeWindow>;
    expect(
      errorGroupOutput(group, "GET /a", {
        ...preset,
        granularity: "hour",
        comparison: "none",
        previous: null,
        previousAvailable: false,
      }).logsPath,
    ).toBe(
      "/modules/api/logs?route=GET+%2Fa&error=Not+found&api.period=last-24h&requests.tab=4xx",
    );
    expect(
      errorGroupOutput(group, "GET /a", {
        ...preset,
        preset: null,
        granularity: "hour",
        comparison: "none",
        previous: null,
        previousAvailable: false,
      }).logsPath,
    ).toContain("since=2026-11-20T10%3A00%3A00.000Z");
  });
});

describe("api.get-request-log", () => {
  const row = {
    _id: "log-2",
    timestamp: NOW,
    method: "GET",
    uri: "/nowhere",
    statusCode: 404,
    responseTimeMs: null,
    responseBodySize: 12_000,
  };

  it("answers the newest of the rows sharing a request id, and how many share it", () => {
    expect(requestLogAnswer([row, { ...row, _id: "log-1" }])).toMatchObject({
      found: true,
      matches: 2,
      log: {
        id: "log-2",
        route: null,
        routeRegistered: false,
        responseBodySize: 12_000,
      },
    });
  });

  it("answers not found as an output, not a failure", () => {
    expect(requestLogAnswer([])).toEqual({
      found: false,
      log: null,
      matches: 0,
    });
  });
});

describe("api.list-routes", () => {
  function row(method: string, path: string): RouteRow {
    return {
      ref: `${method} ${path}`,
      method,
      path,
      folder: path,
      controller: null,
      handler: "h",
      module: null,
    };
  }

  it("keeps the routes under a prefix with the methods asked", () => {
    const rows = [
      row("GET", "/api/orders"),
      row("POST", "/api/orders"),
      row("GET", "/api/ordersx"),
      row("GET", "/health"),
    ];
    expect(
      filterRoutes(rows, { pathPrefix: "/api/orders/", methods: ["get"] }).map(
        (entry) => entry.ref,
      ),
    ).toEqual(["GET /api/orders"]);
  });
});

describe("api.console-link", () => {
  it("builds each page's path, and the URL once the dashboard origin is known", () => {
    setDashboardOrigin(null);
    const cases: Array<[Parameters<typeof consoleLink>[0], string]> = [
      [
        { target: "overview", period: "last-hour" },
        "/modules/api/overview?api.period=last-hour",
      ],
      [
        { target: "route", route: "GET /api/a", tab: "statistics" },
        "/modules/api/routes?route=GET+%2Fapi%2Fa&tab=statistics",
      ],
      [
        { target: "tester", route: "post /api/orders/" },
        "/modules/api/routes?route=POST+%2Fapi%2Forders&tab=tester",
      ],
      [
        { target: "request", requestLogId: "log-1" },
        "/modules/api/logs?record=log-1",
      ],
      [
        { target: "logs", route: "GET /a", statusTab: "5xx", error: "a&b" },
        "/modules/api/logs?route=GET+%2Fa&error=a%26b&requests.tab=5xx",
      ],
      [{ target: "routes" }, "/modules/api/routes"],
      [{ target: "settings" }, "/modules/api/settings"],
    ];
    for (const [input, path] of cases) {
      expect(consoleLink(input), input.target).toEqual({
        path,
        url: null,
        valid: true,
      });
    }
    setDashboardOrigin("https://admin.example.com/");
    expect(consoleLink({ target: "routes" }).url).toBe(
      "https://admin.example.com/modules/api/routes",
    );
    setDashboardOrigin(null);
  });

  it("falls back to the page root, without throwing, when the target's input is missing", () => {
    expect(consoleLink({ target: "route" })).toEqual({
      path: "/modules/api/routes",
      url: null,
      valid: false,
    });
    expect(consoleLink({ target: "request" }).valid).toBe(false);
  });
});
