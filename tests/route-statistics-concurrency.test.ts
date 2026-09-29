import { randomUUID } from "node:crypto";
import type { AtomicMutationOutcome } from "@antelopejs/interface-database/atomic";
import { describe, expect, it } from "vitest";
import {
  getRouteStatsKey,
  type RouteStatistics,
} from "@/db/tables/routes_statistics.table";
import { pruneAllStatistics } from "@/services/statistics-prune";
import { getTodayTimestamp } from "@/services/statistics-utils";
import {
  addRequestStatistics,
  MAX_STATISTICS_WRITE_ATTEMPTS,
  type RouteStatisticsStore,
} from "@/services/statistics-write";
import {
  type DayStatistics,
  MS_PER_DAY,
  type RequestStatistics,
} from "@/types";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * In-memory stand-in for the table, with the driver semantics that matter
 * here: every call yields (so concurrent writers interleave between their
 * read and their write), inserts reject duplicate keys, and
 * `replaceStatistics` applies only when the stored revision still matches.
 */
class FakeStatisticsModel implements RouteStatisticsStore {
  readonly rows = new Map<string, RouteStatistics>();
  replaceCalls = 0;
  forcedOutcome?: AtomicMutationOutcome;

  async get(id: string): Promise<RouteStatistics | undefined> {
    await tick();
    const row = this.rows.get(id);
    return row && structuredClone(row);
  }

  async getAll(): Promise<RouteStatistics[]> {
    await tick();
    return [...this.rows.values()].map((row) => structuredClone(row));
  }

  async insert(
    obj: Parameters<RouteStatisticsStore["insert"]>[0],
  ): Promise<string[]> {
    await tick();
    // The writer inserts one complete row at a time.
    const doc = structuredClone(obj) as RouteStatistics;
    if (this.rows.has(doc._id)) throw new Error("E11000 duplicate key error");
    this.rows.set(doc._id, doc);
    return [doc._id];
  }

  async replaceStatistics(
    doc: RouteStatistics,
  ): Promise<AtomicMutationOutcome> {
    this.replaceCalls++;
    await tick();
    if (this.forcedOutcome) return this.forcedOutcome;
    const stored = this.rows.get(doc._id);
    if (!stored || stored.revision !== doc.revision) return "not-applied";
    stored.statistics = structuredClone(doc.statistics);
    stored.revision = randomUUID();
    return "applied";
  }
}

function request(statusCode = 200, responseTime = 10): RequestStatistics {
  return { method: "GET", uri: "/api/items/:id", statusCode, responseTime };
}

const KEY = getRouteStatsKey("GET", "/api/items/:id");

function dayStats(day: number, requestsCount: number): DayStatistics {
  return {
    day,
    requestsCount,
    averageResponseTime: 10,
    minResponseTime: 10,
    maxResponseTime: 10,
    totalResponseTime: 10 * requestsCount,
    clientErrorsCount: 0,
    serverErrorsCount: 0,
  };
}

function todayOf(model: FakeStatisticsModel): DayStatistics | undefined {
  const today = getTodayTimestamp();
  return model.rows.get(KEY)?.statistics.find((s) => s.day === today);
}

describe("addRequestStatistics", () => {
  it("keeps every increment when requests on one route overlap", async () => {
    const model = new FakeStatisticsModel();
    const requests = [
      ...Array.from({ length: 20 }, () => request(200, 5)),
      ...Array.from({ length: 5 }, () => request(404, 7)),
      ...Array.from({ length: 5 }, () => request(500, 9)),
    ];

    await Promise.all(requests.map((r) => addRequestStatistics(model, r)));

    const row = model.rows.get(KEY);
    expect(row?.statistics).toHaveLength(1);
    expect(todayOf(model)).toMatchObject({
      requestsCount: 30,
      clientErrorsCount: 5,
      serverErrorsCount: 5,
      totalResponseTime: 20 * 5 + 5 * 7 + 5 * 9,
      minResponseTime: 5,
      maxResponseTime: 9,
    });
  });

  it("updates a row written before the revision field existed", async () => {
    const model = new FakeStatisticsModel();
    model.rows.set(KEY, {
      _id: KEY,
      method: "GET",
      uri: "/api/items/:id",
      statistics: [dayStats(getTodayTimestamp(), 3)],
    } as RouteStatistics);

    await addRequestStatistics(model, request());

    expect(todayOf(model)?.requestsCount).toBe(4);
    expect(model.rows.get(KEY)?.revision).toEqual(expect.any(String));
  });

  it("does not retry when the write outcome is unknown", async () => {
    const model = new FakeStatisticsModel();
    await addRequestStatistics(model, request());
    model.forcedOutcome = "unknown";

    await addRequestStatistics(model, request());

    expect(model.replaceCalls).toBe(1);
  });

  it("gives up after a bounded number of conflicting attempts", async () => {
    const model = new FakeStatisticsModel();
    await addRequestStatistics(model, request());
    model.forcedOutcome = "not-applied";

    await expect(addRequestStatistics(model, request())).rejects.toThrow(
      /kept changing concurrently/,
    );
    expect(model.replaceCalls).toBe(MAX_STATISTICS_WRITE_ATTEMPTS);
  });
});

describe("pruneAllStatistics", () => {
  it("does not erase requests recorded while it runs", async () => {
    const model = new FakeStatisticsModel();
    const today = getTodayTimestamp();
    const expired = today - 400 * MS_PER_DAY;
    model.rows.set(KEY, {
      _id: KEY,
      method: "GET",
      uri: "/api/items/:id",
      statistics: [dayStats(expired, 7), dayStats(today, 2)],
      revision: randomUUID(),
    } as RouteStatistics);

    const [pruned] = await Promise.all([
      pruneAllStatistics(model),
      ...Array.from({ length: 10 }, () =>
        addRequestStatistics(model, request()),
      ),
    ]);

    expect(pruned).toBe(1);
    const row = model.rows.get(KEY);
    expect(row?.statistics.map((s) => s.day)).toEqual([today]);
    expect(todayOf(model)?.requestsCount).toBe(12);
  });
});
