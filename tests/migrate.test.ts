import { describe, expect, it, vi } from "vitest";
import type { StoredBodies } from "@/db/models/request_log.model";
import type { RouteStatistics } from "@/db/tables/routes_statistics.table";
import {
  type MigrationModels,
  migrateStoredData,
} from "@/services/request-log/migrate";
import type { DayStatistics } from "@/types";

function day(
  dayMs: number,
  requestsCount: number,
  total: number,
): DayStatistics {
  return {
    day: dayMs,
    requestsCount,
    averageResponseTime: total / requestsCount,
    minResponseTime: 5,
    maxResponseTime: 50,
    totalResponseTime: total,
    clientErrorsCount: 1,
    serverErrorsCount: 0,
  };
}

function setup(bodies: StoredBodies[] = []) {
  const recorded = new Map<string, { completedAt?: Date; cursor?: string }>();
  const rollups = new Map<string, RouteStatistics>([
    [
      "GET:/api/orders/",
      {
        _id: "GET:/api/orders/",
        method: "GET",
        uri: "/api/orders/",
        statistics: [day(1, 2, 20), day(2, 1, 10)],
      } as RouteStatistics,
    ],
    [
      "GET:/api/orders",
      {
        _id: "GET:/api/orders",
        method: "GET",
        uri: "/api/orders",
        statistics: [day(2, 3, 60)],
        revision: "r1",
      } as RouteStatistics,
    ],
    [
      "GET:/api/auth/me",
      {
        _id: "GET:/api/auth/me",
        method: "GET",
        uri: "/api/auth/me",
        statistics: [],
      } as RouteStatistics,
    ],
    [
      "GET:/api/monitoring/logs/live",
      {
        _id: "GET:/api/monitoring/logs/live",
        method: "GET",
        uri: "/api/monitoring/logs/live",
        statistics: [],
      } as RouteStatistics,
    ],
  ]);
  const logs = {
    clearUnmeasuredDurations: vi.fn(() => Promise.resolve(4)),
    renameUri: vi.fn(() => Promise.resolve(10)),
    deleteByUri: vi.fn(() => Promise.resolve(3)),
    deletePageLoads: vi.fn((_pattern: string, _kept: string[]) =>
      Promise.resolve(7),
    ),
    bodiesMatching: vi.fn((_p: string, cursor: string | undefined) =>
      Promise.resolve(cursor ? [] : bodies),
    ),
    replaceBodies: vi.fn(() => Promise.resolve()),
  };
  const models: MigrationModels = {
    migrations: {
      get: (id: string) => Promise.resolve(recorded.get(id) as never),
      record: (id, state) => {
        recorded.set(id, state);
        return Promise.resolve();
      },
    },
    logs,
    stats: {
      get: (id: string) =>
        Promise.resolve(structuredClone(rollups.get(id)) as never),
      getAll: () =>
        Promise.resolve([...rollups.values()].map((r) => structuredClone(r))),
      insert: (row: RouteStatistics) => {
        rollups.set(row._id, row);
        return Promise.resolve([row._id]);
      },
      delete: (id: string) => {
        rollups.delete(id);
        return Promise.resolve(1);
      },
      replaceStatistics: (row: RouteStatistics) => {
        rollups.set(row._id, row);
        return Promise.resolve("applied");
      },
    } as never,
    routes: { getAll: () => Promise.resolve([]) } as never,
    handlerLocations: () => [
      "/api/orders/",
      "/api/monitoring/logs/",
      "/home/pagelayout",
      "/settings/user/notifications/counts/",
    ],
    dmsConsolePaths: () => ["/api/auth/me", "/api/system-state"],
  };
  return { models, logs, rollups, recorded };
}

describe("migrateStoredData", () => {
  it("clears 0 ms durations, drops the console's traffic and renames slashed paths", async () => {
    const { models, logs, rollups } = setup();
    await migrateStoredData(models);

    expect(logs.clearUnmeasuredDurations).toHaveBeenCalledOnce();
    expect(logs.deleteByUri).toHaveBeenCalledWith("/api/monitoring/logs/");
    expect(logs.deleteByUri).toHaveBeenCalledWith("/api/monitoring/logs");
    expect(logs.deleteByUri).toHaveBeenCalledWith("/api/monitoring/logs/live");
    expect(logs.renameUri).toHaveBeenCalledWith("/api/orders/", "/api/orders");
    expect(rollups.has("GET:/api/monitoring/logs/live")).toBe(false);
  });

  it("drops the DMS console's own calls, once", async () => {
    const { models, logs, rollups, recorded } = setup();
    await migrateStoredData(models);

    expect(logs.deleteByUri).toHaveBeenCalledWith("/api/auth/me");
    expect(logs.deleteByUri).toHaveBeenCalledWith("/api/system-state");
    expect(rollups.has("GET:/api/auth/me")).toBe(false);
    expect(recorded.get("dms-console-traffic")?.completedAt).toBeInstanceOf(
      Date,
    );
    const calls = logs.deleteByUri.mock.calls.length;
    await migrateStoredData(models);
    expect(logs.deleteByUri.mock.calls.length).toBe(calls);
  });

  it("drops the DMS's Settings endpoints too, where the first pass already ran", async () => {
    const { models, logs, rollups, recorded } = setup();
    recorded.set("dms-console-traffic", { completedAt: new Date(0) });
    rollups.set("GET:/settings/activity", {
      _id: "GET:/settings/activity",
      method: "GET",
      uri: "/settings/activity",
      statistics: [],
    } as RouteStatistics);
    models.dmsConsolePaths = () => [
      "/api/auth/me",
      "/settings/activity",
      "/api/tables/members/list",
    ];
    await migrateStoredData(models);

    expect(logs.deleteByUri).toHaveBeenCalledWith("/settings/activity");
    expect(logs.deleteByUri).toHaveBeenCalledWith("/api/tables/members/list");
    expect(rollups.has("GET:/settings/activity")).toBe(false);
    expect(rollups.has("GET:/api/orders")).toBe(true);
    expect(recorded.get("dms-console-endpoints")?.completedAt).toBeInstanceOf(
      Date,
    );
    const calls = logs.deleteByUri.mock.calls.length;
    await migrateStoredData(models);
    expect(logs.deleteByUri.mock.calls.length).toBe(calls);
  });

  it("drops the loads of the DMS console's pages, but the answered paths, once", async () => {
    const { models, logs, recorded } = setup();
    await migrateStoredData(models);

    expect(logs.deletePageLoads).toHaveBeenCalledOnce();
    const [pattern, kept] = logs.deletePageLoads.mock.calls[0];
    const pages = new RegExp(pattern);
    for (const path of ["/", "/modules/api", "/modules/api/logs", "/auth"])
      expect(pages.test(path)).toBe(true);
    for (const path of ["/api/auth/login", "/modulesx", "/webhooks/stripe"])
      expect(pages.test(path)).toBe(false);
    expect(kept).toEqual([
      "/home/pagelayout",
      "/settings/user/notifications/counts",
    ]);
    expect(recorded.get("dms-console-pages")?.completedAt).toBeInstanceOf(Date);
    await migrateStoredData(models);
    expect(logs.deletePageLoads).toHaveBeenCalledOnce();
  });

  it("merges a slashed rollup into the canonical one", async () => {
    const { models, rollups } = setup();
    await migrateStoredData(models);

    expect(rollups.has("GET:/api/orders/")).toBe(false);
    const merged = rollups.get("GET:/api/orders")?.statistics ?? [];
    expect(
      merged.map((d) => [d.day, d.requestsCount, d.totalResponseTime]),
    ).toEqual([
      [1, 2, 20],
      [2, 4, 70],
    ]);
    expect(merged[1].averageResponseTime).toBe(17.5);
    expect(merged[1].clientErrorsCount).toBe(2);
  });

  it("redacts stored card data and runs each pass once", async () => {
    const { models, logs, recorded } = setup([
      {
        _id: "a",
        timestamp: new Date(),
        requestBody: '{"cardNumber":"4242 4242 4242 4242","sku":"DESK"}',
        responseBody: '{"id":"10482"}',
      },
      {
        _id: "b",
        timestamp: new Date(),
        requestBody: '{"card":"[REDACTED]"}',
      },
    ]);
    await migrateStoredData(models);

    expect(logs.replaceBodies).toHaveBeenCalledTimes(1);
    expect(logs.replaceBodies).toHaveBeenCalledWith("a", {
      requestBody: '{"cardNumber":"[REDACTED]","sku":"DESK"}',
    });
    expect(recorded.get("card-redaction")?.completedAt).toBeInstanceOf(Date);

    await migrateStoredData(models);
    expect(logs.clearUnmeasuredDurations).toHaveBeenCalledOnce();
    expect(logs.bodiesMatching).toHaveBeenCalledOnce();
  });
});
