import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RequestLogFilters,
  RequestLogSample,
} from "@/db/models/request_log.model";
import type { RouteStatistics } from "@/db/tables/routes_statistics.table";
import { clearAggregateCache } from "@/services/aggregate-cache";
import { evaluateRoutes } from "@/services/route-health";
import {
  emptyHistogram,
  histogramQuantile,
  latencyBucketIndex,
} from "@/services/statistics-utils";
import {
  addDay,
  emptyBucket,
  forgetRecentScan,
  loadErrorSamples,
  loadTraffic,
  p95Latency,
  sumBuckets,
  type TrafficModels,
} from "@/services/traffic";
import { pinnedNow, presetRange } from "@/services/window";
import { type DayStatistics, MS_PER_DAY, MS_PER_HOUR } from "@/types";

/** The logs table, in memory: what `samples` reads, and how often. */
class FakeLogs {
  scans = 0;
  lastFilters: RequestLogFilters | undefined;
  constructor(readonly rows: RequestLogSample[]) {}

  async samples(filters: RequestLogFilters): Promise<RequestLogSample[]> {
    this.scans += 1;
    this.lastFilters = filters;
    return this.rows.filter(
      (row) =>
        (!filters.since || row.timestamp >= filters.since) &&
        (!filters.until || row.timestamp < filters.until) &&
        (filters.statusMin === undefined ||
          row.statusCode >= filters.statusMin),
    );
  }
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** The day rollups the capture would have written for `rows`. */
function rollupsOf(rows: RequestLogSample[]): RouteStatistics[] {
  const days = new Map<number, DayStatistics>();
  for (const row of rows) {
    const day = startOfDay(row.timestamp.getTime());
    const stats = days.get(day) ?? {
      day,
      requestsCount: 0,
      averageResponseTime: 0,
      minResponseTime: 0,
      maxResponseTime: 0,
      totalResponseTime: 0,
      clientErrorsCount: 0,
      serverErrorsCount: 0,
      timedRequestsCount: 0,
      latencyHistogram: emptyHistogram(),
    };
    stats.requestsCount += 1;
    if (row.responseTimeMs !== null) {
      stats.timedRequestsCount += 1;
      stats.latencyHistogram[latencyBucketIndex(row.responseTimeMs)] += 1;
    }
    stats.totalResponseTime += row.responseTimeMs ?? 0;
    stats.maxResponseTime = Math.max(
      stats.maxResponseTime,
      row.responseTimeMs ?? 0,
    );
    if (row.statusCode >= 500) stats.serverErrorsCount += 1;
    days.set(day, stats);
  }
  return [
    {
      _id: "GET:/a",
      method: "GET",
      uri: "/a",
      statistics: [...days.values()],
      revision: "r1",
    },
  ];
}

/** One call every 20 minutes over the last 20 days, ending now. */
function history(now: number): RequestLogSample[] {
  const rows: RequestLogSample[] = [];
  for (let at = now - 20 * MS_PER_DAY; at < now; at += MS_PER_HOUR / 3) {
    rows.push({
      timestamp: new Date(at),
      method: "GET",
      uri: "/a",
      statusCode: rows.length % 10 === 0 ? 500 : 200,
      responseTimeMs: 40,
    });
  }
  return rows;
}

function models(rows: RequestLogSample[]) {
  const logs = new FakeLogs(rows);
  const models: TrafficModels = {
    logs,
    stats: { getAll: async () => rollupsOf(rows) },
  };
  return { logs, models };
}

function countIn(rows: RequestLogSample[], from: Date, to: Date): number {
  return rows.filter((row) => row.timestamp >= from && row.timestamp < to)
    .length;
}

beforeEach(() => {
  clearAggregateCache();
  forgetRecentScan();
});

describe("rolling day windows", () => {
  it("split the day they share with the period before, counting it once", async () => {
    const now = pinnedNow();
    const rows = history(now.getTime());
    const { models: m } = models(rows);
    const current = presetRange("last-7-days", now);
    const previous = {
      from: new Date(current.from.getTime() - 7 * MS_PER_DAY),
      to: current.from,
    };
    const [a, b] = await Promise.all([
      loadTraffic(m, current, "day", null),
      loadTraffic(m, previous, "day", null),
    ]);
    expect(sumBuckets(a).requests).toBe(
      countIn(rows, current.from, current.to),
    );
    expect(sumBuckets(b).requests).toBe(
      countIn(rows, previous.from, previous.to),
    );
  });
});

describe("shared computation", () => {
  it("scans the logs once for every block reading the last day", async () => {
    const now = pinnedNow();
    const { logs, models: m } = models(history(now.getTime()));
    const range = presetRange("last-24h", now);
    const [hourly, again, lastHour] = await Promise.all([
      loadTraffic(m, range, "hour", null),
      loadTraffic(m, range, "hour", new Set(["GET:/a"])),
      loadTraffic(m, presetRange("last-hour", now), "minute", null),
    ]);
    expect(logs.scans).toBe(1);
    expect(sumBuckets(hourly).requests).toBe(72);
    expect(sumBuckets(again).requests).toBe(72);
    expect(sumBuckets(lastHour).requests).toBe(3);
  });

  it("keeps the routes out of scope out of the sums", async () => {
    const now = pinnedNow();
    const { models: m } = models(history(now.getTime()));
    const buckets = await loadTraffic(
      m,
      presetRange("last-24h", now),
      "hour",
      new Set(["POST:/b"]),
    );
    expect(sumBuckets(buckets).requests).toBe(0);
  });
});

describe("the last day, as the clock moves", () => {
  afterEach(() => vi.useRealTimers());

  it("reads only its end again, catching a request stored late", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = pinnedNow(new Date("2026-10-10T12:00:02.000Z")).getTime();
    vi.setSystemTime(start);
    const rows = history(start);
    const { logs, models: m } = models(rows);
    await loadTraffic(m, presetRange("last-24h", pinnedNow()), "hour", null);
    expect(logs.scans).toBe(1);

    const late = (at: number): RequestLogSample => ({
      timestamp: new Date(at),
      method: "GET",
      uri: "/a",
      statusCode: 500,
      responseTimeMs: 40,
    });
    rows.push(late(start - 2_000), late(start + 3_000));
    vi.setSystemTime(start + 10_000);
    const range = presetRange("last-24h", pinnedNow());
    const buckets = await loadTraffic(m, range, "hour", null);
    expect(
      logs.scans,
      "Stored after the first scan: one timestamped just before its end, one after it.",
    ).toBe(2);
    expect(logs.lastFilters?.since).toEqual(new Date(start - 30_000));
    expect(sumBuckets(buckets).requests).toBe(
      countIn(rows, range.from, range.to),
    );
    expect(sumBuckets(buckets).serverErrors).toBe(
      rows.filter(
        (row) =>
          row.statusCode >= 500 &&
          row.timestamp >= range.from &&
          row.timestamp < range.to,
      ).length,
    );
  });

  it("reads only the new errors of a week ending now, the status unindexed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = pinnedNow(new Date("2026-10-10T12:00:02.000Z")).getTime();
    vi.setSystemTime(start);
    const rows = history(start);
    const { logs } = models(rows);
    await loadErrorSamples(
      logs,
      presetRange("last-7-days", pinnedNow()),
      null,
      500,
    );
    expect(logs.scans).toBe(1);

    rows.push(
      {
        timestamp: new Date(start - 2_000),
        method: "GET",
        uri: "/a",
        statusCode: 503,
        responseTimeMs: 40,
      },
      {
        timestamp: new Date(start + 3_000),
        method: "GET",
        uri: "/a",
        statusCode: 200,
        responseTimeMs: 40,
      },
    );
    vi.setSystemTime(start + 10_000);
    const range = presetRange("last-7-days", pinnedNow());
    const errors = await loadErrorSamples(logs, range, null, 500);
    expect(logs.scans).toBe(2);
    expect(logs.lastFilters).toMatchObject({
      since: new Date(start - 30_000),
      statusMin: 500,
    });
    expect(errors).toHaveLength(
      rows.filter(
        (row) =>
          row.statusCode >= 500 &&
          row.timestamp >= range.from &&
          row.timestamp < range.to,
      ).length,
    );

    const past = presetRange("last-7-days", new Date(start - MS_PER_DAY));
    await loadErrorSamples(logs, past, null, 500);
    expect(
      logs.lastFilters?.since,
      "A window in the past is scanned whole, and extends nothing.",
    ).toEqual(past.from);
  });
});

describe("one p95 per route and window", () => {
  /** 100 calls over the last 20 hours, from 2,000 to 2,313 ms. */
  function slowRoute(now: number): RequestLogSample[] {
    return Array.from({ length: 100 }, (_, index) => ({
      timestamp: new Date(now - (index + 1) * 12 * 60_000),
      method: "GET",
      uri: "/pdf",
      statusCode: 200,
      responseTimeMs: 2000 + Math.round((index * 313) / 99),
    }));
  }

  it("is exact over the logs, the same as the health rules', never above the max", async () => {
    const now = pinnedNow();
    const rows = slowRoute(now.getTime());
    const { models: m } = models(rows);
    const range = presetRange("last-24h", now);
    const total = sumBuckets(await loadTraffic(m, range, "hour", null));
    const health = evaluateRoutes(rows, range, 1000).get("GET:/pdf");
    expect(total.maxLatency).toBe(2313);
    expect(p95Latency(total)).toBe(health?.p95Ms);
    expect(p95Latency(total)).toBeLessThanOrEqual(total.maxLatency);
  });

  it("stays within the measured range when read off a histogram", () => {
    const histogram = emptyHistogram();
    for (let ms = 2000; ms <= 2313; ms += 1) {
      histogram[latencyBucketIndex(ms)] += 1;
    }
    const p95 = histogramQuantile(histogram, 0.95, { min: 2000, max: 2313 });
    expect(
      p95,
      "The bucket [2000, 3000) alone would put it near 2,950 ms.",
    ).toBeGreaterThan(2000);
    expect(p95).toBeLessThanOrEqual(2313);
    const open = emptyHistogram();
    open[open.length - 1] = 10;
    expect(histogramQuantile(open, 0.95, { min: 12_000, max: 15_000 })).toBe(
      14_850,
    );
  });

  it("reads the p95 of rollup days off their histograms", () => {
    const day = (start: number, histogram: number[]) => {
      const bucket = emptyBucket(start);
      addDay(bucket, {
        day: start,
        requestsCount: 10,
        timedRequestsCount: 10,
        averageResponseTime: 100,
        minResponseTime: 40,
        maxResponseTime: 180,
        totalResponseTime: 1000,
        clientErrorsCount: 0,
        serverErrorsCount: 0,
        latencyHistogram: histogram,
      });
      return bucket;
    };
    const kept = emptyHistogram();
    kept[latencyBucketIndex(60)] = 9;
    kept[latencyBucketIndex(180)] = 1;
    const total = sumBuckets([day(0, kept), day(MS_PER_DAY, kept)]);
    const p95 = p95Latency(total);
    expect(p95).not.toBeNull();
    expect(p95).toBeLessThanOrEqual(180);
    expect(p95Latency(emptyBucket(0))).toBeNull();
  });
});
