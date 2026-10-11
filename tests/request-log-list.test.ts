import { describe, expect, it, vi } from "vitest";
import type { RequestLogListItem } from "@/db/models/request_log.model";
import type { RequestLog } from "@/db/tables/request_log.table";
import {
  filtersFromQuery,
  listRequestLogs,
  listRequestLogsSince,
  namesUnknownRoute,
  parseAfter,
  toRow,
} from "@/services/request-log/list";
import { getRouteLatency } from "@/services/request-log/read";
import { MS_PER_DAY, MS_PER_HOUR } from "@/types";

const NOW = new Date("2026-10-07T15:00:00.000Z");

describe("filtersFromQuery", () => {
  it("reads the tab, the quick filters and the search", () => {
    const filters = filtersFromQuery(
      {
        filter_statusClass: "is:5xx",
        filter_method: "is:POST",
        filter_slow: "is:true",
        filter_window: "is:1h",
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
      { filter_window: "is:30d", requestId: " 6f1c " },
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
        filter_window: "is:24h",
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
        filter_window: "is:24h",
        filter_from: "is:2026-10-03T18:31:00.000Z",
        filter_to: "is:2026-10-03T18:46:00.000Z",
      },
      NOW,
    );
    expect(filters.since).toEqual(new Date("2026-10-03T18:31:00.000Z"));
    expect(filters.until).toEqual(new Date("2026-10-03T18:46:00.000Z"));
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
        filter_window: "is:14d",
        filter_route: "is:nonsense",
        filter_slow: "is:false",
      }),
    ).toEqual({});
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
      message: "Invoice not found",
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
      source: "tester",
      requestId: "6f1c",
      // The status pill's tone, by its class.
      statusTone: "warning",
    });
  });
});

const COUNTS = { all: 3, "2xx": 2, "4xx": 1, "5xx": 0 };

function fakeModel() {
  return {
    list: vi.fn(() =>
      Promise.resolve({ results: [], total: 3, counts: COUNTS }),
    ),
    since: vi.fn(() =>
      Promise.resolve({ results: [], count: 0, serverErrors: 0, tester: 0 }),
    ),
  };
}

describe("listRequestLogs", () => {
  it("answers the counts of every tab with the page", async () => {
    const model = fakeModel();
    const page = await listRequestLogs(model, { limit: "100000" }, null);
    expect(page).toEqual({ results: [], total: 3, counts: COUNTS });
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
    expect(page).toEqual({
      results: [],
      total: 0,
      counts: { all: 0, "2xx": 0, "4xx": 0, "5xx": 0 },
    });
    expect(model.list).not.toHaveBeenCalled();
  });

  it("counts a tab without reading its row", async () => {
    const model = fakeModel();
    await listRequestLogs(
      model,
      { limit: "1", filter_statusClass: "is:5xx" },
      null,
    );
    expect(model.list).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 0 }),
    );
    await listRequestLogs(
      model,
      { limit: "1", sortKey: "timestamp", sortDirection: "desc" },
      null,
    );
    expect(model.list).toHaveBeenLastCalledWith(
      expect.anything(),
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
    const since = await listRequestLogsSince(model, {}, NOW, null, options);
    expect(since).toMatchObject({ results: [], count: 0 });
    expect(model.since).not.toHaveBeenCalled();
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

describe("listRequestLogsSince", () => {
  it("reads the rows after the cursor and moves the cursor to the newest", async () => {
    const model = fakeModel();
    const newest = new Date("2026-10-07T15:00:05.000Z");
    model.since.mockResolvedValue({
      results: [
        {
          _id: "b",
          timestamp: newest,
          method: "GET",
          uri: "/api/orders",
          rawPath: "/api/orders",
          statusCode: 200,
          responseTimeMs: 12,
        },
      ],
      count: 7,
    } as never);
    const after = parseAfter("2026-10-07T15:00:00.000Z");
    expect(after).toEqual(NOW);
    const page = await listRequestLogsSince(
      model,
      { filter_statusClass: "is:2xx", limit: "9999" },
      NOW,
      new Set(["GET:/api/orders"]),
    );
    expect(model.since).toHaveBeenCalledWith(
      { statusClass: "success", routeKeys: ["GET:/api/orders"] },
      NOW,
      500,
    );
    expect(page.count).toBe(7);
    expect(page.cursor).toBe(newest.toISOString());
    expect(page.results.map((row) => row._id)).toEqual(["b"]);
  });

  it("keeps the cursor when nothing arrived", async () => {
    const page = await listRequestLogsSince(fakeModel(), {}, NOW, null);
    expect(page).toEqual({
      results: [],
      count: 0,
      serverErrors: 0,
      tester: 0,
      cursor: NOW.toISOString(),
      now: expect.any(String),
    });
  });

  it("counts without reading a row for `limit=0`, the Tester apart", async () => {
    const model = fakeModel();
    model.since.mockResolvedValue({
      results: [],
      count: 23,
      serverErrors: 4,
      tester: 1,
    });
    const page = await listRequestLogsSince(model, { limit: "0" }, NOW, null);
    expect(model.since).toHaveBeenCalledWith({}, NOW, 0);
    expect(page).toMatchObject({ count: 23, serverErrors: 4, tester: 1 });
    expect(page.cursor).toBe(NOW.toISOString());
  });

  it("refuses an unreadable cursor", () => {
    expect(parseAfter("yesterday-ish")).toBeUndefined();
    expect(parseAfter(undefined)).toBeUndefined();
  });
});

describe("getRouteLatency", () => {
  it("reads the p50, p95 and slow requests of a route's week", async () => {
    const samples = vi.fn(() =>
      Promise.resolve([
        { statusCode: 200, responseTimeMs: 10 },
        { statusCode: 200, responseTimeMs: 20 },
        { statusCode: 200, responseTimeMs: 1200 },
        { statusCode: 500, responseTimeMs: 3000 },
        { statusCode: 404, responseTimeMs: null },
      ] as never),
    );
    const latency = await getRouteLatency(
      { samples },
      { method: "GET", uri: "/api/latency-a" },
      1000,
      NOW,
    );
    expect(latency).toEqual({ windowDays: 7, p50: 20, p95: 1200, slow: 2 });
    expect(samples).toHaveBeenCalledWith({
      routeMethod: "GET",
      uri: "/api/latency-a",
      since: new Date(NOW.getTime() - 7 * MS_PER_DAY),
      apiTrafficOnly: true,
    });
  });

  it("is null without a successful request measured", async () => {
    const latency = await getRouteLatency(
      { samples: () => Promise.resolve([] as never) },
      { method: "GET", uri: "/api/latency-b" },
      1000,
      NOW,
    );
    expect(latency).toBeNull();
  });
});
