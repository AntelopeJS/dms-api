import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setConfig } from "@/config";
import type {
  RequestLogFilters,
  RequestLogSample,
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

/** The logs table, in memory: what `samples` reads, and over which ranges. */
class FakeLogs {
  ranges: [number, number][] = [];
  constructor(readonly rows: RequestLogSample[]) {}

  async samples(filters: RequestLogFilters): Promise<RequestLogSample[]> {
    this.ranges.push([
      filters.since?.getTime() ?? 0,
      filters.until?.getTime() ?? 0,
    ]);
    return this.rows.filter(
      (row) =>
        (!filters.since || row.timestamp >= filters.since) &&
        (!filters.until || row.timestamp < filters.until),
    );
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
    expect(liveBucketMs(MS_PER_HOUR)).toBe(MS_PER_MINUTE);
    expect(liveBucketMs(MS_PER_DAY)).toBe(15 * MS_PER_MINUTE);
    expect(liveBucketMs(7 * MS_PER_DAY)).toBe(2 * MS_PER_HOUR);
    expect(liveBucketMs(30 * MS_PER_DAY)).toBe(6 * MS_PER_HOUR);
  });

  it("picks a custom range's bar by the same rule", () => {
    expect(liveBucketMs(3 * MS_PER_HOUR)).toBe(2 * MS_PER_MINUTE);
    expect(liveBucketMs(10 * MS_PER_MINUTE)).toBe(MS_PER_MINUTE);
    expect(liveBucketMs(0)).toBe(MS_PER_MINUTE);
    expect(liveBucketMs(365 * MS_PER_DAY)).toBe(MS_PER_DAY);
  });

  it("takes an asked bar only when offered and within the cap", () => {
    expect(resolveBucketMs(`${10 * MS_PER_MINUTE}`, MS_PER_DAY)).toBe(
      10 * MS_PER_MINUTE,
    );
    // 288 bars: past the cap.
    expect(resolveBucketMs(`${5 * MS_PER_MINUTE}`, MS_PER_DAY)).toBe(
      15 * MS_PER_MINUTE,
    );
    expect(resolveBucketMs(`${MS_PER_MINUTE}`, MS_PER_DAY)).toBe(
      15 * MS_PER_MINUTE,
    );
    expect(resolveBucketMs("12345", MS_PER_HOUR)).toBe(MS_PER_MINUTE);
    expect(resolveBucketMs("nope", MS_PER_HOUR)).toBe(MS_PER_MINUTE);
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
    // The first bar starts on the minute after the hour began, as before.
    expect(traffic.total).toBe(2);
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

    // A later tick reads only the last day again, not the 30 before.
    const scans = logs.ranges.length;
    vi.setSystemTime(NOW.getTime() + 10_000);
    await getLiveTraffic(logs, null, query, new Date());
    const fresh = logs.ranges.slice(scans);
    expect(fresh.length).toBeGreaterThan(0);
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
