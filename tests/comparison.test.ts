import { beforeEach, describe, expect, it } from "vitest";
import type {
  RequestLogFilters,
  RequestLogSample,
} from "@/db/models/request_log.model";
import { clearAggregateCache } from "@/services/aggregate-cache";
import {
  alignComparison,
  comparisonSeriesName,
  shownComparison,
  versusText,
  withVersus,
} from "@/services/comparison";
import { count, milliseconds, percent, text } from "@/services/composed-text";
import { getErrorShareChart, getTrafficChart } from "@/services/overview";
import { getSlowestRoutes, getStatusClasses } from "@/services/overview-lists";
import {
  errorRateChart,
  latencyChart,
  loadRouteTraffic,
  routeSummary,
  routeTopErrors,
} from "@/services/route-statistics";
import { forgetRecentScan, type TrafficModels } from "@/services/traffic";
import {
  pinnedNow,
  resolveWindow,
  type WindowComparison,
} from "@/services/window";
import { MS_PER_DAY, MS_PER_HOUR } from "@/types";

/** The logs table, in memory: what the traffic and the errors read. */
class FakeLogs {
  constructor(readonly rows: RequestLogSample[]) {}

  async samples(filters: RequestLogFilters): Promise<RequestLogSample[]> {
    return this.rows.filter(
      (row) =>
        (!filters.since || row.timestamp >= filters.since) &&
        (!filters.until || row.timestamp < filters.until) &&
        (filters.statusMin === undefined ||
          row.statusCode >= filters.statusMin),
    );
  }
}

/**
 * Two days of `GET /a`: the day before the last 24 h has two calls an hour
 * at 40 ms, all fine; the last 24 h four calls an hour at 80 ms, one in
 * four a 500. Every figure doubles, or is new, against the period before.
 */
function history(now: number): RequestLogSample[] {
  const rows: RequestLogSample[] = [];
  const add = (at: number, statusCode: number, responseTimeMs: number) =>
    rows.push({
      timestamp: new Date(at),
      method: "GET",
      uri: "/a",
      statusCode,
      responseTimeMs,
    });
  for (let hour = 1; hour <= 24; hour += 1) {
    const current = now - hour * MS_PER_HOUR + 60_000;
    for (let call = 0; call < 4; call += 1) {
      add(current + call * 1000, call === 0 ? 500 : 200, 80);
    }
    const previous = current - MS_PER_DAY;
    for (let call = 0; call < 2; call += 1) {
      add(previous + call * 1000, 200, 40);
    }
  }
  return rows;
}

let now: Date;
let logs: FakeLogs;

/** The models the traffic reads: only the logs hold rows. */
function fakeModels(): TrafficModels {
  return { logs, stats: { getAll: async () => [] } };
}

const overviewModels = fakeModels;
const catalogModels = fakeModels;

function windowFor(comparison: WindowComparison) {
  return resolveWindow({ preset: "last-24h", comparison }, "last-24h", now);
}

/** A custom comparison a year back: past every retention, so not kept. */
function unkeptWindow() {
  const yearBack = (days: number) =>
    new Date(now.getTime() - days * MS_PER_DAY).toISOString();
  return resolveWindow(
    {
      preset: "last-24h",
      comparison: "custom",
      compareFrom: yearBack(366),
      compareTo: yearBack(365),
    },
    "last-24h",
    now,
  );
}

beforeEach(() => {
  clearAggregateCache();
  forgetRecentScan();
  now = pinnedNow();
  logs = new FakeLogs(history(now.getTime()));
});

describe("comparison texts", () => {
  it("writes the change and the value compared with, signed", () => {
    expect(versusText("previous-period", 120, 100, count)).toEqual(
      text("compare.versus.previous_period", {
        delta: text("compare.change_percent", {
          sign: "+",
          value: percent(20),
        }),
        previous: count(100),
      }),
    );
    expect(versusText("custom", 50, 100, count)).toMatchObject({
      key: "api.compare.versus.custom",
      params: { delta: { params: { sign: "−", value: percent(50) } } },
    });
  });

  it("writes a rate's change in points", () => {
    expect(versusText("custom", 3.4, 2.2, percent, "pt")).toMatchObject({
      key: "api.compare.versus.custom",
      params: {
        delta: {
          key: "api.compare.change_points",
          params: { sign: "+", value: 1.2 },
        },
        previous: percent(2.2),
      },
    });
  });

  it("says there was none rather than an endless rise from zero", () => {
    expect(versusText("previous-period", 4, 0, count)).toEqual(
      text("compare.from_zero.previous_period"),
    );
    expect(versusText("previous-period", 0, 0, count)).toMatchObject({
      params: { delta: { params: { sign: "+", value: percent(0) } } },
    });
  });

  it("lays the comparison on the window's buckets, position by position", () => {
    expect(
      alignComparison(
        [{ start: 10 }, { start: 20 }, { start: 30 }],
        [{ v: 1 }, { v: 2 }],
        (bucket) => bucket.v,
      ),
    ).toEqual([
      { x: 10, y: 1 },
      { x: 20, y: 2 },
      { x: 30, y: null },
    ]);
  });

  it("adds the comparison to a detail line only when there is one", () => {
    const detail = text("routes.statistics.p95_detail");
    expect(withVersus(detail, undefined)).toBe(detail);
    expect(withVersus(detail, text("x"))).toEqual(
      text("compare.with", { detail, versus: text("x") }),
    );
  });

  it("shows a comparison only when one is picked and still kept", () => {
    expect(shownComparison(windowFor("previous-period"))).toBe(
      "previous-period",
    );
    expect(shownComparison(windowFor("none"))).toBeNull();
    expect(
      shownComparison(unkeptWindow()),
      "A compared range past the 30 days of logs is not kept.",
    ).toBeNull();
    expect(comparisonSeriesName("previous-period")).toBe(
      "$api.compare.series.previous_period",
    );
  });
});

describe("Overview comparisons", () => {
  it("draws the calls of the period before as a dashed line over the traffic columns", async () => {
    const chart = await getTrafficChart(
      overviewModels(),
      windowFor("previous-period"),
      null,
    );
    expect(chart).toMatchObject({
      value: 96,
      previousValue: 48,
      delta: 100,
      deltaUnit: "percent",
    });
    const [line] = chart.comparisonSeries ?? [];
    expect(line).toMatchObject({
      name: "$api.compare.series.previous_period",
      type: "line",
    });
    expect(
      line?.data.map((point) => point.x),
      "On the window's own x, two calls an hour then.",
    ).toEqual(chart.series[0]?.data.map((point) => point.x));
    expect(line?.data.filter((point) => point.y === 2)).toHaveLength(24);
  });

  it("draws the error share of the period before as a dashed line, its delta in points", async () => {
    const chart = await getErrorShareChart(
      overviewModels(),
      windowFor("previous-period"),
      null,
    );
    expect(chart).toMatchObject({
      value: 25,
      previousValue: 0,
      delta: 25,
      deltaUnit: "pt",
    });
    const [line] = chart.comparisonSeries ?? [];
    expect(line?.type).toBe("line");
    expect(line?.data.filter((point) => point.y === 0)).toHaveLength(24);
  });

  it("drops the series, the delta and the vs figure without a comparison", async () => {
    for (const window of [windowFor("none"), unkeptWindow()]) {
      for (const chart of [
        await getTrafficChart(overviewModels(), window, null),
        await getErrorShareChart(overviewModels(), window, null),
      ]) {
        expect(chart).not.toHaveProperty("comparisonSeries");
        expect(chart).not.toHaveProperty("previousValue");
        expect(chart).not.toHaveProperty("delta");
      }
    }
  });

  it("says each status class against the period before", async () => {
    const { items } = await getStatusClasses(
      overviewModels(),
      windowFor("previous-period"),
      null,
    );
    const [success, , server] = items;
    expect(success?.description).toMatchObject({
      key: "api.compare.with",
      params: {
        detail: { key: "api.overview.classes.share" },
        versus: {
          key: "api.compare.versus.previous_period",
          params: { previous: count(48) },
        },
      },
    });
    expect(
      server?.description,
      'No 5xx the day before: "none over the previous period".',
    ).toMatchObject({
      params: { versus: text("compare.from_zero.previous_period") },
    });
    const plain = await getStatusClasses(
      overviewModels(),
      windowFor("none"),
      null,
    );
    expect(plain.items[0]?.description).toMatchObject({
      key: "api.overview.classes.share",
    });
  });

  it("says each slow route's average against the period before", async () => {
    const { items } = await getSlowestRoutes(
      overviewModels(),
      windowFor("previous-period"),
      null,
    );
    expect(items[0]?.description).toMatchObject({
      key: "api.compare.with",
      params: {
        detail: { key: "api.overview.slowest.detail" },
        versus: {
          key: "api.compare.versus.previous_period",
          params: {
            delta: { params: { sign: "+", value: percent(100) } },
            previous: milliseconds(40),
          },
        },
      },
    });
    const plain = await getSlowestRoutes(
      overviewModels(),
      windowFor("none"),
      null,
    );
    expect(plain.items[0]?.description).toMatchObject({
      key: "api.overview.slowest.detail",
    });
  });
});

describe("Routes comparisons", () => {
  const route = { method: "GET", path: "/a" };

  async function trafficFor(comparison: WindowComparison) {
    return loadRouteTraffic(catalogModels(), route, windowFor(comparison));
  }

  it("says every figure of the summary against the period before", async () => {
    const [requests, latency, errors, max] = routeSummary(
      await trafficFor("previous-period"),
      1000,
    ).items;
    expect(requests).toMatchObject({
      detail: {
        key: "api.compare.versus.previous_period",
        params: { previous: count(48) },
      },
      detailTone: "success",
    });
    expect(latency?.detail).toMatchObject({
      key: "api.compare.with",
      params: {
        detail: { key: "api.routes.statistics.p95_detail" },
        versus: { params: { delta: { params: { value: percent(100) } } } },
      },
    });
    expect(errors?.detail).toMatchObject({
      params: {
        detail: { key: "api.routes.statistics.error_split" },
        versus: {
          params: {
            delta: {
              key: "api.compare.change_points",
              params: { sign: "+", value: 25 },
            },
            previous: percent(0),
          },
        },
      },
    });
    expect(max?.detail).toMatchObject({
      params: { detail: { key: "api.routes.statistics.slow_line" } },
    });
  });

  it("keeps the summary to the period alone without a comparison", async () => {
    const [requests, latency, errors] = routeSummary(
      await trafficFor("none"),
      1000,
    ).items;
    expect(requests).not.toHaveProperty("detail");
    expect(latency?.detail).toMatchObject({
      key: "api.routes.statistics.p95_detail",
    });
    expect(errors?.detail).toMatchObject({
      key: "api.routes.statistics.error_split",
    });
  });

  it("says a compared range no longer kept rather than comparing with zeros", async () => {
    const [requests, latency] = routeSummary(
      await loadRouteTraffic(catalogModels(), route, unkeptWindow()),
      1000,
    ).items;
    expect(requests).toMatchObject({
      detail: "$api.compare.no_baseline.custom",
      detailTone: "neutral",
    });
    expect(latency?.detail).toMatchObject({
      key: "api.routes.statistics.p95_detail",
    });
  });

  it("draws the error rate of the period before dashed, its vs figure in points", async () => {
    const chart = errorRateChart(await trafficFor("previous-period"));
    expect(chart).toMatchObject({
      value: 25,
      previousValue: 0,
      delta: 25,
      deltaUnit: "pt",
    });
    const [line] =
      "comparisonSeries" in chart ? (chart.comparisonSeries ?? []) : [];
    expect(line?.name).toBe("$api.compare.series.previous_period");
    expect(line?.data).toHaveLength(chart.series[0]?.data.length ?? 0);
  });

  it("draws the average of the period before dashed, with its delta", async () => {
    const chart = latencyChart(await trafficFor("previous-period"), 1000);
    expect(chart).toMatchObject({
      value: 80,
      previousValue: 40,
      delta: 100,
      deltaUnit: "percent",
    });
    const [line] =
      "comparisonSeries" in chart ? (chart.comparisonSeries ?? []) : [];
    expect(line?.data.filter((point) => point.y === 40)).toHaveLength(24);
  });

  it("draws the route charts alone without a comparison", async () => {
    const traffic = await trafficFor("none");
    const rate = errorRateChart(traffic);
    const latency = latencyChart(traffic, 1000);
    for (const chart of [rate, latency]) {
      expect(chart).not.toHaveProperty("comparisonSeries");
      expect(chart).not.toHaveProperty("previousValue");
    }
    expect(latency).toMatchObject({ delta: null });
  });
});

describe("Routes top errors comparison", () => {
  const route = { method: "GET", path: "/a" };

  it("counts each top error against the period before", async () => {
    const { items } = await routeTopErrors(
      catalogModels(),
      route,
      windowFor("previous-period"),
      "GET /a",
    );
    expect(items[0]).toMatchObject({ value: 24, previous: 0 });
    expect(items[0]?.description).toMatchObject({
      key: "api.compare.with",
      params: { versus: text("compare.from_zero.previous_period") },
    });
    const plain = await routeTopErrors(
      catalogModels(),
      route,
      windowFor("none"),
      "GET /a",
    );
    expect(plain.items[0]).not.toHaveProperty("previous");
    expect(plain.items[0]?.description).toMatchObject({
      key: "api.routes.statistics.server_error",
    });
  });
});
