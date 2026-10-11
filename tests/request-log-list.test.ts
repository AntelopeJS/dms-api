import { describe, expect, it, vi } from "vitest";
import type { RequestLogListItem } from "@/db/models/request_log.model";
import type { RequestLog } from "@/db/tables/request_log.table";
import {
  filtersFromQuery,
  listRequestLogs,
  namesUnknownRoute,
  statusClassOf,
  toRow,
} from "@/services/request-log/list";
import { STATUS_CLASS_RANGES } from "@/db/models/request_log.status";
import { getRouteLatency } from "@/services/request-log/read";
import {
  emptyHistogram,
  latencyBucketIndex,
} from "@/services/statistics-utils";
import { type DayStatistics, MS_PER_DAY, MS_PER_HOUR } from "@/types";

const NOW = new Date("2026-10-07T15:00:00.000Z");

describe("filtersFromQuery", () => {
  it("reads the tab, the quick filters and the search", () => {
    const filters = filtersFromQuery(
      {
        filter_statusClass: "is:5xx",
        filter_method: "is:POST",
        filter_slow: "is:true",
        preset: "last-hour",
        search: "  stripe ",
      },
      NOW,
    );
    expect(filters).toMatchObject({
      statusClass: "server-error",
      method: "POST",
      slowThresholdMs: 1000,
      search: "stripe",
    });
    expect(filters.since).toEqual(new Date(NOW.getTime() - MS_PER_HOUR));
  });

  it("narrows to a route named `METHOD /path`", () => {
    expect(
      filtersFromQuery({ filter_route: "is:POST /webhooks/stripe" }),
    ).toMatchObject({ routeMethod: "POST", uri: "/webhooks/stripe" });
  });

  it("names the same route with or without its trailing slash", () => {
    expect(filtersFromQuery({ filter_route: "is:GET /api/orders/" }).uri).toBe(
      "/api/orders",
    );
    expect(filtersFromQuery({ filter_route: "is:GET /api/orders" }).uri).toBe(
      "/api/orders",
    );
  });

  it("reads the 30-day period and a request id", () => {
    const filters = filtersFromQuery(
      { preset: "last-30-days", requestId: " 6f1c " },
      NOW,
    );
    expect(filters.requestId).toBe("6f1c");
    expect(filters.since?.getTime()).toBeLessThanOrEqual(NOW.getTime());
    expect(NOW.getTime() - (filters.since?.getTime() ?? 0)).toBeLessThanOrEqual(
      30 * MS_PER_DAY,
    );
  });

  it("reads several methods and a [from, to) range", () => {
    const filters = filtersFromQuery(
      {
        filter_method: "is:GET,POST",
        preset: "last-24h",
        filter_from: "is:2026-10-07T14:59:00.000Z",
        filter_to: "is:2026-10-07T15:00:00.000Z",
      },
      NOW,
    );
    expect(filters.method).toBeUndefined();
    expect(filters.methods).toEqual(["GET", "POST"]);
    expect(filters.since).toEqual(new Date("2026-10-07T14:59:00.000Z"));
    expect(filters.until).toEqual(NOW);
  });

  it("frames an incident older than the period by its own range", () => {
    const filters = filtersFromQuery(
      {
        preset: "last-24h",
        filter_from: "is:2026-10-03T18:31:00.000Z",
        filter_to: "is:2026-10-03T18:46:00.000Z",
      },
      NOW,
    );
    expect(filters.since).toEqual(new Date("2026-10-03T18:31:00.000Z"));
    expect(filters.until).toEqual(new Date("2026-10-03T18:46:00.000Z"));
  });

  it("lists a held table as it stood when it froze", () => {
    const held = "2026-10-07T14:58:00.000Z";
    expect(
      filtersFromQuery({ search: "orders", liveHeldAt: held }, NOW).until,
    ).toEqual(new Date(held));
    // An incident ending earlier keeps its own end.
    expect(
      filtersFromQuery(
        { filter_to: "is:2026-10-07T14:00:00.000Z", liveHeldAt: held },
        NOW,
      ).until,
    ).toEqual(new Date("2026-10-07T14:00:00.000Z"));
    expect(filtersFromQuery({ liveHeldAt: "soon" }, NOW).until).toBeUndefined();
  });

  it("keeps the colons of an error message", () => {
    expect(
      filtersFromQuery({
        filter_error: "is:TypeError: Cannot read properties of null",
      }).errorMessage,
    ).toBe("TypeError: Cannot read properties of null");
  });

  it("ignores values it does not know", () => {
    expect(
      filtersFromQuery({
        filter_statusClass: "is:6xx",
        filter_route: "is:nonsense",
        filter_slow: "is:false",
      }),
    ).toEqual({});
  });
});

describe("filtersFromQuery, the period", () => {
  it("rolls a preset up to now, the newest rows included", () => {
    const filters = filtersFromQuery(
      {
        preset: "last-24h",
        from: "2026-10-06T00:00:00.000Z",
        to: "2026-10-07T23:59:59.999Z",
      },
      NOW,
    );
    expect(filters.since).toEqual(new Date(NOW.getTime() - MS_PER_DAY));
    expect(filters.until).toBeUndefined();
  });

  it("takes a custom range as given, within the log retention", () => {
    const filters = filtersFromQuery(
      {
        preset: "custom",
        from: "2026-10-06T00:00:00.000Z",
        to: "2026-10-06T12:00:00.000Z",
      },
      NOW,
    );
    expect(filters.since).toEqual(new Date("2026-10-06T00:00:00.000Z"));
    expect(filters.until).toEqual(new Date("2026-10-06T12:00:00.000Z"));
    const old = filtersFromQuery({ from: "2020-01-01T00:00:00.000Z" }, NOW);
    expect(NOW.getTime() - (old.since?.getTime() ?? 0)).toBeLessThanOrEqual(
      30 * MS_PER_DAY,
    );
  });

  it("lists every period with `all`, and no bound without a period", () => {
    expect(
      filtersFromQuery({ preset: "last-hour", filter_all: "is:true" }, NOW)
        .since,
    ).toBeUndefined();
    expect(filtersFromQuery({ requestId: "6f1c" }, NOW).since).toBeUndefined();
  });
});

describe("status classes", () => {
  it("names each status by its hundred", () => {
    expect([101, 200, 204, 304, 404, 503].map(statusClassOf)).toEqual([
      "1xx",
      "2xx",
      "2xx",
      "3xx",
      "4xx",
      "5xx",
    ]);
  });

  it("keeps the 3xx out of the 2xx tab", () => {
    expect(STATUS_CLASS_RANGES.success).toEqual({ min: 200, max: 300 });
  });
});

describe("toRow", () => {
  it("names the route, the status class and slowness of a request", () => {
    const row = toRow({
      _id: "req_1",
      timestamp: NOW,
      method: "GET",
      uri: "/api/invoices/:id/pdf",
      rawPath: "/api/invoices/INV-1/pdf",
      statusCode: 404,
      responseTimeMs: 1500.4,
      errorMessage: "Invoice not found",
    } as RequestLogListItem);
    expect(row).toMatchObject({
      route: "GET /api/invoices/:id/pdf",
      path: "/api/invoices/INV-1/pdf",
      status: "404",
      statusClass: "4xx",
      responseTimeMs: 1500,
      slow: true,
      durationTone: "warning",
      message: "Invoice not found",
      errorTone: "error",
    });
  });

  it("keeps the fraction of a duration under a millisecond", () => {
    const row = (responseTimeMs: number) =>
      toRow({
        _id: "req_3",
        timestamp: NOW,
        method: "POST",
        uri: "/api/orders",
        rawPath: "/api/orders",
        statusCode: 413,
        responseTimeMs,
      } as RequestLogListItem).responseTimeMs;
    expect(row(0.2802)).toBe(0.28);
    expect(row(0.0004)).toBe(0.01);
    expect(row(1.4)).toBe(1);
  });
});

describe("namesUnknownRoute", () => {
  it("tells a route filter it cannot read", () => {
    expect(namesUnknownRoute({ filter_route: "is:garbage" })).toBe(true);
    expect(namesUnknownRoute({ filter_route: "is:GET /api/orders/" })).toBe(
      false,
    );
    expect(namesUnknownRoute({})).toBe(false);
  });
});

describe("toRow, unmeasured and Tester requests", () => {
  it("keeps an unmeasured duration null and the source of the request", () => {
    const row = toRow({
      _id: "req_2",
      timestamp: NOW,
      method: "HEAD" as RequestLog["method"],
      routeMethod: "GET",
      uri: "/api/orders",
      rawPath: "/api/orders",
      statusCode: 404,
      responseTimeMs: null,
      source: "tester",
      requestId: "6f1c",
    } as RequestLogListItem);
    expect(row).toMatchObject({
      route: "GET /api/orders",
      responseTimeMs: null,
      slow: false,
      durationTone: null,
      errorTone: null,
      source: "tester",
      requestId: "6f1c",
      // The status pill's tone, by its class.
      statusTone: "warning",
    });
  });
});

function fakeModel() {
  return {
    list: vi.fn(() => Promise.resolve({ results: [], total: 3 })),
  };
}

describe("listRequestLogs", () => {
  it("answers the page with its total", async () => {
    const model = fakeModel();
    const page = await listRequestLogs(model, { limit: "100000" }, null);
    expect(page).toEqual({ results: [], total: 3 });
    expect(model.list).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 5000 }),
    );
  });

  it("finds a request by its id outside the scope on the logs page", async () => {
    const model = fakeModel();
    await listRequestLogs(model, { requestId: "6f1c" }, new Set(), {
      findOutsideScope: true,
    });
    expect(model.list).toHaveBeenCalledWith(
      { requestId: "6f1c" },
      expect.anything(),
    );
  });

  it("keeps the other tables to the scope, an id or a path named", async () => {
    const model = fakeModel();
    const keys = new Set(["GET:/api/orders"]);
    await listRequestLogs(model, { filter_path: "is:/admin" }, keys);
    expect(model.list).toHaveBeenCalledWith(
      { rawPath: "/admin", routeKeys: ["GET:/api/orders"] },
      expect.anything(),
    );
  });

  it("lists the Tester's calls alone when asked", async () => {
    const model = fakeModel();
    await listRequestLogs(model, { requestId: "6f1c" }, null, {
      testerOnly: true,
    });
    expect(model.list).toHaveBeenCalledWith(
      { requestId: "6f1c", testerOnly: true },
      expect.anything(),
    );
  });

  it("lists nothing for a route it cannot read", async () => {
    const model = fakeModel();
    const page = await listRequestLogs(
      model,
      { filter_route: "is:garbage" },
      null,
    );
    expect(page).toEqual({ results: [], total: 0 });
    expect(model.list).not.toHaveBeenCalled();
  });

  it("reads the row a one-row page asks for", async () => {
    const model = fakeModel();
    await listRequestLogs(
      model,
      { limit: "1", filter_statusClass: "is:5xx" },
      null,
    );
    expect(model.list).toHaveBeenCalledWith(
      expect.objectContaining({ statusClass: "server-error" }),
      expect.objectContaining({ limit: 1 }),
    );
  });

  it("lists the requests to one path outside the scope on the logs page", async () => {
    const model = fakeModel();
    await listRequestLogs(
      model,
      { filter_path: "is:/api/nope" },
      new Set(["GET:/api/orders"]),
      { findOutsideScope: true },
    );
    expect(model.list).toHaveBeenCalledWith(
      { rawPath: "/api/nope" },
      expect.anything(),
    );
  });

  it("lists nothing without a route where one is required", async () => {
    const model = fakeModel();
    const options = { requireRoute: true };
    const page = await listRequestLogs(model, {}, null, options);
    expect(page.total).toBe(0);
    expect(model.list).not.toHaveBeenCalled();
    await listRequestLogs(
      model,
      { filter_route: "is:GET /api/orders" },
      null,
      options,
    );
    expect(model.list).toHaveBeenCalledOnce();
  });

  it("answers an empty scope without a query", async () => {
    const model = fakeModel();
    const page = await listRequestLogs(model, {}, new Set());
    expect(page.total).toBe(0);
    expect(model.list).not.toHaveBeenCalled();
  });
});

/** A day rollup of a route whose calls took `durations`. */
function rollupDay(day: number, durations: number[]): DayStatistics {
  const latencyHistogram = emptyHistogram();
  for (const ms of durations) latencyHistogram[latencyBucketIndex(ms)] += 1;
  const total = durations.reduce((sum, ms) => sum + ms, 0);
  return {
    day,
    requestsCount: durations.length,
    timedRequestsCount: durations.length,
    averageResponseTime: total / durations.length,
    minResponseTime: Math.min(...durations),
    maxResponseTime: Math.max(...durations),
    totalResponseTime: total,
    clientErrorsCount: 0,
    serverErrorsCount: 0,
    latencyHistogram,
  };
}

describe("getRouteLatency", () => {
  const today = new Date(NOW).setHours(0, 0, 0, 0);

  it("reads the p50 and p95 of a route's week from its rollups", async () => {
    const statistics = [
      rollupDay(today - 9 * MS_PER_DAY, [9000, 9000, 9000]),
      rollupDay(
        today - MS_PER_DAY,
        Array.from({ length: 19 }, () => 20),
      ),
      rollupDay(today, [1200]),
    ];
    const getByRoute = vi.fn(() => Promise.resolve({ statistics } as never));
    const list = vi.fn(() => Promise.resolve({ results: [], total: 2 }));
    const latency = await getRouteLatency(
      { stats: { getByRoute }, logs: { list } },
      { method: "GET", uri: "/api/latency-a" },
      1000,
      NOW,
    );
    expect(latency?.windowDays).toBe(7);
    expect(latency?.slow).toBe(2);
    // 19 calls of 20 ms and one of 1.2 s: the older day is left out.
    expect(latency?.p50).toBeGreaterThanOrEqual(20);
    expect(latency?.p50).toBeLessThan(25);
    expect(latency?.p95).toBeLessThanOrEqual(25);
    expect(getByRoute).toHaveBeenCalledWith("GET", "/api/latency-a");
    expect(list).toHaveBeenCalledWith(
      {
        routeMethod: "GET",
        uri: "/api/latency-a",
        since: new Date(NOW.getTime() - 7 * MS_PER_DAY),
        apiTrafficOnly: true,
        slowThresholdMs: 1000,
      },
      { limit: 0 },
    );
  });

  it("is null without a call measured", async () => {
    const latency = await getRouteLatency(
      {
        stats: { getByRoute: () => Promise.resolve(undefined) },
        logs: { list: () => Promise.resolve({ results: [], total: 0 }) },
      },
      { method: "GET", uri: "/api/latency-b" },
      1000,
      NOW,
    );
    expect(latency).toBeNull();
  });
});
