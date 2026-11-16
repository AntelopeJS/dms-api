import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setConfig } from "@/config";
import type {
  RequestLogFilters,
  RequestLogSample,
  RequestLogStatusCount,
} from "@/db/models/request_log.model";
import { clearAggregateCache } from "@/services/aggregate-cache";
import {
  barOf,
  getLiveTraffic,
  liveBucketMs,
  liveRange,
  resolveBucketMs,
} from "@/services/live";
import { forgetDayCounts, forgetRecentScan } from "@/services/traffic";
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from "@/types";

/**
 * The logs table, in memory: the rows `samples` reads and over which ranges,
 * and the calls `statusCounts` counts the way the database groups them.
 */
class FakeLogs {
  ranges: [number, number][] = [];
  constructor(readonly rows: RequestLogSample[]) {}

  private within(filters: RequestLogFilters): RequestLogSample[] {
    return this.rows.filter(
      (row) =>
        (!filters.since || row.timestamp >= filters.since) &&
        (!filters.until || row.timestamp < filters.until),
    );
  }

  async samples(filters: RequestLogFilters): Promise<RequestLogSample[]> {
    this.ranges.push([
      filters.since?.getTime() ?? 0,
      filters.until?.getTime() ?? 0,
    ]);
    return this.within(filters);
  }

  async statusCounts(
    filters: RequestLogFilters,
  ): Promise<RequestLogStatusCount[]> {
    const groups = new Map<string, RequestLogStatusCount>();
    for (const row of this.within(filters)) {
      const minute =
        Math.floor(row.timestamp.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE;
      const call = [row.method, row.uri, minute, row.statusCode].join(" ");
      const group = groups.get(call) ?? {
        method: row.method,
        uri: row.uri,
        minute,
        statusCode: row.statusCode,
        requests: 0,
      };
      group.requests += 1;
      groups.set(call, group);
    }
    return [...groups.values()];
  }
}

const NOW = new Date("2026-10-07T15:00:02.000Z");

/** One call every 20 minutes over the last `days` days, every tenth a 500. */
function history(days: number, uri = "/a"): RequestLogSample[] {
  const rows: RequestLogSample[] = [];
  const end = NOW.getTime();
  for (let at = end - days * MS_PER_DAY; at < end; at += 20 * MS_PER_MINUTE) {
    rows.push({
      timestamp: new Date(at),
      method: "GET",
      uri,
      statusCode: rows.length % 10 === 0 ? 500 : 200,
      responseTimeMs: 40,
    });
  }
  return rows;
}

/** The range of the last `spanMs`, up to now. */
function upToNow(spanMs: number) {
  return { from: NOW.getTime() - spanMs, to: NOW.getTime(), live: true };
}

function barsTotal(
  buckets: { success: number; clientErrors: number; serverErrors: number }[],
) {
  return buckets.reduce(
    (total, bar) => total + bar.success + bar.clientErrors + bar.serverErrors,
    0,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  clearAggregateCache();
  forgetRecentScan();
  forgetDayCounts();
});

afterEach(() => {
  vi.useRealTimers();
  setConfig();
});

describe("liveBucketMs", () => {
  it("draws every preset in 50 to 120 bars", () => {
    expect(liveBucketMs(upToNow(MS_PER_HOUR))).toBe(MS_PER_MINUTE);
    expect(liveBucketMs(upToNow(MS_PER_DAY))).toBe(15 * MS_PER_MINUTE);
    expect(liveBucketMs(upToNow(7 * MS_PER_DAY))).toBe(2 * MS_PER_HOUR);
    expect(liveBucketMs(upToNow(30 * MS_PER_DAY))).toBe(6 * MS_PER_HOUR);
  });

  it("picks a custom range's bar by the same rule", () => {
    expect(liveBucketMs(upToNow(3 * MS_PER_HOUR))).toBe(2 * MS_PER_MINUTE);
    expect(liveBucketMs(upToNow(10 * MS_PER_MINUTE))).toBe(MS_PER_MINUTE);
    expect(liveBucketMs(upToNow(0))).toBe(MS_PER_MINUTE);
    expect(liveBucketMs(upToNow(365 * MS_PER_DAY))).toBe(MS_PER_DAY);
  });

  it("takes an asked bar only when offered and within the cap", () => {
    expect(resolveBucketMs(`${10 * MS_PER_MINUTE}`, upToNow(MS_PER_DAY))).toBe(
      10 * MS_PER_MINUTE,
    );
    expect(
      resolveBucketMs(`${5 * MS_PER_MINUTE}`, upToNow(MS_PER_DAY)),
      "288 bars: past the cap.",
    ).toBe(15 * MS_PER_MINUTE);
    expect(resolveBucketMs(`${MS_PER_MINUTE}`, upToNow(MS_PER_DAY))).toBe(
      15 * MS_PER_MINUTE,
    );
    expect(resolveBucketMs("12345", upToNow(MS_PER_HOUR))).toBe(MS_PER_MINUTE);
    expect(resolveBucketMs("nope", upToNow(MS_PER_HOUR))).toBe(MS_PER_MINUTE);
  });
});

describe("liveRange", () => {
  it("rolls a preset up to now, the last hour without any", () => {
    expect(liveRange({}, NOW)).toEqual({
      period: "last-hour",
      range: { from: new Date(NOW.getTime() - MS_PER_HOUR), to: NOW },
    });
    expect(liveRange({ preset: "last-7-days" }, NOW).period).toBe(
      "last-7-days",
    );
  });

  it("reads all time as every request kept", () => {
    setConfig({ requestLogRetention: 10 * MS_PER_DAY });
    const { period, range } = liveRange({ preset: "all" }, NOW);
    expect(period).toBe("all");
    expect(range.to.getTime() - range.from.getTime()).toBe(10 * MS_PER_DAY);
  });

  it("keeps a custom range within the retention and never past now", () => {
    const { period, range } = liveRange(
      {
        preset: "custom",
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-10-09T00:00:00.000Z",
      },
      NOW,
    );
    expect(period).toBeNull();
    expect(range.to).toEqual(NOW);
    expect(NOW.getTime() - range.from.getTime()).toBe(30 * MS_PER_DAY);
  });
});

describe("getLiveTraffic", () => {
  it("draws the last hour by minute, the last bar still running", async () => {
    const logs = new FakeLogs(history(1));
    const traffic = await getLiveTraffic(logs, null, {}, NOW);
    expect(traffic.buckets).toHaveLength(60);
    expect(traffic.bucketMs).toBe(MS_PER_MINUTE);
    expect(traffic.live).toBe(true);
    expect(traffic.buckets.at(-1)?.start).toBe(
      Math.floor(NOW.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE,
    );
    expect(
      traffic.total,
      "The first bar starts on the minute after the hour began, as before.",
    ).toBe(2);
  });

  it("draws the last 24 hours in 96 bars of 15 minutes", async () => {
    const logs = new FakeLogs(history(2));
    const traffic = await getLiveTraffic(
      logs,
      null,
      { preset: "last-24h" },
      NOW,
    );
    expect(traffic.buckets).toHaveLength(96);
    expect(traffic.bucketMs).toBe(15 * MS_PER_MINUTE);
    expect(barsTotal(traffic.buckets)).toBe(traffic.total);
    expect(traffic.total).toBe(71);
  });

  it("sums 30 days from the calls per minute, each past day read once", async () => {
    const rows = history(40);
    const logs = new FakeLogs(rows);
    const query = { preset: "last-30-days" };
    const traffic = await getLiveTraffic(logs, null, query, NOW);
    expect(traffic.buckets).toHaveLength(120);
    expect(traffic.bucketMs).toBe(6 * MS_PER_HOUR);
    const from = Math.max(
      new Date(traffic.from).getTime(),
      traffic.buckets[0].start,
    );
    const expected = rows.filter((row) => {
      const at = row.timestamp.getTime();
      return at >= from && at < NOW.getTime();
    });
    expect(traffic.total).toBe(expected.length);
    expect(barsTotal(traffic.buckets)).toBe(traffic.total);
    expect(traffic.serverErrors).toBe(
      expected.filter((row) => row.statusCode >= 500).length,
    );

    const scans = logs.ranges.length;
    vi.setSystemTime(NOW.getTime() + 10_000);
    await getLiveTraffic(logs, null, query, new Date());
    const fresh = logs.ranges.slice(scans);
    expect(
      fresh.length,
      "A later tick reads only the last day again, not the 30 before.",
    ).toBeGreaterThan(0);
    for (const [since] of fresh) {
      expect(NOW.getTime() - since).toBeLessThanOrEqual(MS_PER_DAY);
    }
  });

  it("keeps the routes out of scope out of a long window", async () => {
    const logs = new FakeLogs([...history(8), ...history(8, "/b")]);
    const traffic = await getLiveTraffic(
      logs,
      new Set(["GET:/a"]),
      { preset: "last-7-days" },
      NOW,
    );
    forgetDayCounts();
    clearAggregateCache();
    forgetRecentScan();
    const alone = await getLiveTraffic(
      new FakeLogs(history(8)),
      null,
      { preset: "last-7-days" },
      NOW,
    );
    expect(traffic.buckets).toHaveLength(84);
    expect(traffic.total).toBeGreaterThan(0);
    expect(traffic.total).toBe(alone.total);
  });

  it("does not follow now over a past range", async () => {
    const logs = new FakeLogs(history(3));
    const traffic = await getLiveTraffic(
      logs,
      null,
      {
        preset: "custom",
        from: "2026-10-05T10:00:00.000Z",
        to: "2026-10-05T13:00:00.000Z",
      },
      NOW,
    );
    expect(traffic.live).toBe(false);
    expect(traffic.period).toBeNull();
    expect(traffic.bucketMs).toBe(2 * MS_PER_MINUTE);
    expect(traffic.buckets).toHaveLength(90);
    expect(traffic.total).toBe(9);
  });

  it("starts bars of hours on the hour of the server's clock", () => {
    const at = new Date(2026, 9, 7, 13, 47).getTime();
    expect(new Date(barOf(at, 6 * MS_PER_HOUR)).getHours()).toBe(12);
    expect(new Date(barOf(at, 2 * MS_PER_HOUR)).getMinutes()).toBe(0);
  });
});

/**
 * Calls over the last nine days on two routes, `/a` also logged as `/a/`:
 * every status class, several calls of one route and status in the same
 * minute, calls on the first and the last millisecond of a minute and around
 * local midnight.
 */
function mixedHistory(): RequestLogSample[] {
  const statuses = [200, 201, 302, 399, 400, 404, 499, 500, 503];
  const routes: [string, string][] = [
    ["GET", "/a"],
    ["GET", "/a/"],
    ["POST", "/b"],
  ];
  const rows: RequestLogSample[] = [];
  const add = (at: number) => {
    const [method, uri] = routes[rows.length % routes.length];
    rows.push({
      timestamp: new Date(at),
      method,
      uri,
      statusCode: statuses[rows.length % statuses.length],
      responseTimeMs: 10,
    });
  };
  const end = NOW.getTime();
  for (let at = end - 9 * MS_PER_DAY; at < end; at += 47 * MS_PER_MINUTE) {
    const minute = Math.floor(at / MS_PER_MINUTE) * MS_PER_MINUTE;
    add(minute);
    add(minute + 59_999);
    for (let tie = 0; tie < 3; tie += 1) add(at + 13_500);
  }
  for (let day = 1; day <= 8; day += 1) {
    const midnight = new Date(NOW);
    midnight.setDate(midnight.getDate() - day);
    midnight.setHours(0, 0, 0, 0);
    add(midnight.getTime() - 1);
    add(midnight.getTime());
  }
  return rows;
}

/**
 * The bars as read from every row: a call counts in the bar of its minute
 * when that minute starts at or after the minute of `from` and before `to`,
 * and a call of today when it falls inside the range.
 */
function barsFromRows(
  rows: RequestLogSample[],
  traffic: Awaited<ReturnType<typeof getLiveTraffic>>,
  keys: Set<string> | null,
) {
  const from = new Date(traffic.from).getTime();
  const to = new Date(traffic.to).getTime();
  const today = new Date(NOW).setHours(0, 0, 0, 0);
  const counted = rows.filter((row) => {
    const at = row.timestamp.getTime();
    const minute = Math.floor(at / MS_PER_MINUTE) * MS_PER_MINUTE;
    const key = `${row.method}:${row.uri.replace(/\/+$/, "")}`;
    return (
      (!keys || keys.has(key)) &&
      minute >= Math.floor(from / MS_PER_MINUTE) * MS_PER_MINUTE &&
      minute < to &&
      (at < today || (at >= Math.max(from, today) && at < to))
    );
  });
  return traffic.buckets.map(({ start }) => {
    const inBar = counted.filter((row) => {
      const at = row.timestamp.getTime();
      const minute = Math.floor(at / MS_PER_MINUTE) * MS_PER_MINUTE;
      return minute >= start && minute < start + traffic.bucketMs;
    });
    const serverErrors = inBar.filter((row) => row.statusCode >= 500).length;
    const clientErrors = inBar.filter(
      (row) => row.statusCode >= 400 && row.statusCode < 500,
    ).length;
    return {
      start,
      success: inBar.length - clientErrors - serverErrors,
      clientErrors,
      serverErrors,
    };
  });
}

describe("a window longer than a day", () => {
  it("counts its past days in the database, reading none of their rows", async () => {
    const logs = new FakeLogs(history(40));
    const traffic = await getLiveTraffic(
      logs,
      null,
      { preset: "last-30-days" },
      NOW,
    );
    expect(traffic.total).toBeGreaterThan(0);
    expect(
      logs.ranges,
      "Only the shared scan of the last day reads rows.",
    ).toHaveLength(1);
    expect(logs.ranges[0][1] - logs.ranges[0][0]).toBe(MS_PER_DAY);
  });

  it.each([
    ["the last 7 days", { preset: "last-7-days" }, null],
    ["the last 30 days", { preset: "last-30-days" }, null],
    ["the last 7 days of one route", { preset: "last-7-days" }, ["GET:/a"]],
    [
      "a past range off the minute",
      {
        preset: "custom",
        from: new Date(NOW.getTime() - 5.3 * MS_PER_DAY - 1234).toISOString(),
        to: new Date(NOW.getTime() - 1.7 * MS_PER_DAY + 4321).toISOString(),
      },
      null,
    ],
  ])("draws %s as every row counted one by one", async (_, query, scope) => {
    const rows = mixedHistory();
    const keys = scope ? new Set(scope) : null;
    const traffic = await getLiveTraffic(new FakeLogs(rows), keys, query, NOW);
    const bars = barsFromRows(rows, traffic, keys);
    expect(traffic.buckets).toEqual(bars);
    expect(
      [traffic.total, traffic.clientErrors, traffic.serverErrors],
      "The totals are the bars'.",
    ).toEqual([
      barsTotal(bars),
      bars.reduce((sum, bar) => sum + bar.clientErrors, 0),
      bars.reduce((sum, bar) => sum + bar.serverErrors, 0),
    ]);
    expect(traffic.serverErrors).toBeGreaterThan(0);
    expect(traffic.clientErrors).toBeGreaterThan(0);
  });
});

describe("a past range", () => {
  it("starts off the bar boundaries and draws in at most 120 whole bars", async () => {
    const from = NOW.getTime() - 6 * MS_PER_DAY;
    const to = NOW.getTime() - MS_PER_DAY;
    const traffic = await getLiveTraffic(
      new FakeLogs(history(7)),
      null,
      {
        preset: "custom",
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      },
      NOW,
    );
    const first = traffic.buckets[0]?.start ?? Number.NaN;
    const last = traffic.buckets.at(-1)?.start ?? Number.NaN;
    expect(traffic.buckets.length).toBeGreaterThanOrEqual(50);
    expect(traffic.buckets.length).toBeLessThanOrEqual(120);
    expect(first).toBeLessThanOrEqual(from);
    expect(last + traffic.bucketMs).toBeGreaterThanOrEqual(to);
  });
});
