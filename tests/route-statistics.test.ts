import { describe, expect, it } from "vitest";
import {
  errorRateChart,
  latencyChart,
  routeActivity,
  routeSummary,
  type RouteTraffic,
} from "@/services/route-statistics";
import {
  emptyHistogram,
  latencyBucketIndex,
} from "@/services/statistics-utils";
import { sumBuckets, type TrafficBucket } from "@/services/traffic";
import { resolveWindow, type WindowComparison } from "@/services/window";

function bucket(start: number, fields: Partial<TrafficBucket>): TrafficBucket {
  return {
    start,
    requests: 0,
    clientErrors: 0,
    serverErrors: 0,
    totalLatency: 0,
    maxLatency: 0,
    minLatency: 0,
    histogram: emptyHistogram(),
    ...fields,
    // Every call timed, unless told otherwise.
    timed: fields.timed ?? fields.requests ?? 0,
  };
}

/** A histogram of `durations`. */
function histogram(durations: number[]): number[] {
  const counts = emptyHistogram();
  for (const ms of durations) counts[latencyBucketIndex(ms)] += 1;
  return counts;
}

const buckets = [
  bucket(1, {
    requests: 8,
    clientErrors: 1,
    serverErrors: 1,
    totalLatency: 800,
    maxLatency: 300,
    minLatency: 20,
    histogram: histogram([20, 50, 50, 60, 80, 90, 150, 300]),
  }),
  bucket(2, {}),
  bucket(3, {
    requests: 2,
    totalLatency: 100,
    maxLatency: 60,
    minLatency: 40,
    histogram: histogram([40, 60]),
  }),
];

const traffic: RouteTraffic = {
  buckets,
  total: sumBuckets(buckets),
  previous: bucket(0, {
    requests: 5,
    clientErrors: 1,
    totalLatency: 400,
    maxLatency: 100,
  }),
  window: resolveWindow({ comparison: "previous-period" }, "last-24h"),
};

describe("route statistics", () => {
  it("sums up calls, latency with its p95, errors and the slowest call", () => {
    const [requests, latency, errors, max] = routeSummary(traffic, 250).items;
    expect(requests).toMatchObject({ value: 10, detailTone: "success" });
    expect(requests?.detail).toMatchObject({
      params: { delta: { params: { sign: "+", value: { value: 1 } } } },
    });
    expect(latency?.value).toMatchObject({ params: { value: { value: 90 } } });
    // The p95 under the average, not the minimum.
    expect(latency?.detail).toMatchObject({
      params: { detail: { key: "api.routes.statistics.p95_detail" } },
    });
    expect(errors?.value).toMatchObject({
      params: { rate: { value: 0.2 } },
    });
    expect(errors?.detail).toMatchObject({
      params: {
        detail: { params: { client: { value: 1 }, server: { value: 1 } } },
      },
    });
    expect(errors?.detailTone).toBe("error");
    expect(max).toMatchObject({ tone: "warning", detailTone: "warning" });
  });

  it("gives the delta of an error rate in points", () => {
    expect(errorRateChart(traffic)).toMatchObject({
      value: 20,
      delta: 0,
      deltaUnit: "pt",
    });
  });

  it("says when no duration was measured", () => {
    const untimed = [bucket(1, { requests: 2, timed: 0 })];
    const [, latency, , max] = routeSummary(
      { ...traffic, buckets: untimed, total: sumBuckets(untimed) },
      250,
    ).items;
    expect(latency?.value).toBe("—");
    expect(latency?.detail).toEqual({ key: "api.routes.statistics.p95_none" });
    expect(max).toMatchObject({ value: "—", tone: "muted" });
  });

  it("charts the 4xx and 5xx rates, a gap where nobody called", () => {
    const chart = errorRateChart(traffic);
    expect(chart.series.map((series) => series.name)).toEqual(["4xx", "5xx"]);
    expect(chart.series[1]?.data).toEqual([
      { x: 1, y: 12.5 },
      { x: 2, y: null },
      { x: 3, y: 0 },
    ]);
  });

  it("charts average, max and p95 with gaps, and gives the slow threshold", () => {
    const chart = latencyChart(traffic, 1000);
    expect(chart.series.map((series) => series.name)).toEqual([
      "$api.routes.statistics.series_average",
      "$api.routes.statistics.series_max",
      "$api.routes.statistics.series_p95",
    ]);
    expect(chart.series[0]?.data).toEqual([
      { x: 1, y: 100 },
      { x: 2, y: null },
      { x: 3, y: 50 },
    ]);
    expect(chart).toMatchObject({ slowThresholdMs: 1000 });
    // Every p95 point within its bucket's max.
    expect(chart.series[2]?.data[0]?.y).toBeLessThanOrEqual(300);
  });

  it("sizes the axis to hold the slow threshold, above or below the points", () => {
    expect(latencyChart(traffic, 1000)).toMatchObject({ yMin: 0, yMax: 1100 });
    expect(latencyChart(traffic, 100)).toMatchObject({ yMax: 400 });
  });

  it("says when there is no previous period", () => {
    const [requests] = routeSummary({ ...traffic, previous: null }, 250).items;
    expect(requests).toMatchObject({
      detail: "$api.compare.no_baseline.previous_period",
      detailTone: "neutral",
    });
  });

  it("has no figures for a route without calls", () => {
    const empty: RouteTraffic = {
      buckets: [],
      total: sumBuckets([]),
      previous: null,
    };
    expect(routeSummary(empty, 250).items).toEqual([]);
    // No series: the charts show their empty state, not 0 %.
    expect(errorRateChart(empty)).toEqual({ series: [] });
    expect(latencyChart(empty, 1000)).toEqual({ series: [] });
  });

  it("leads an idle route to its Tester, saying when none of its calls is kept", () => {
    const empty: RouteTraffic = {
      buckets: [],
      total: sumBuckets([]),
      previous: null,
    };
    const tester = {
      label: "$api.routes.statistics.idle_try",
      icon: "i-ph-paper-plane-tilt",
      to: "/modules/api/routes?route=GET+%2Fapi%2Forders&tab=tester",
    };
    expect(routeActivity(empty, "GET /api/orders", null)).toEqual({
      calls: 0,
      emptyState: {
        description: "$api.routes.statistics.idle_never",
        actions: [tester],
      },
    });
    expect(
      routeActivity(empty, "GET /api/orders", "2026-10-01T10:00:00.000Z"),
    ).toEqual({ calls: 0, emptyState: { actions: [tester] } });
  });

  it("counts the calls of a busy route, with no empty state", () => {
    expect(
      routeActivity(
        { ...traffic, previous: null },
        "GET /api/orders",
        "2026-10-01T10:00:00.000Z",
      ),
    ).toEqual({ calls: traffic.total.requests });
  });
});

describe("route statistics comparisons", () => {
  it("names the comparison picked beside the calls, nothing without one", () => {
    const comparedWith = (comparison: WindowComparison, previous = true) => {
      const window = resolveWindow({ comparison }, "last-24h");
      const [requests] = routeSummary(
        { ...traffic, previous: previous ? traffic.previous : null, window },
        250,
      ).items;
      return requests;
    };
    expect(comparedWith("previous-period")).toMatchObject({
      detail: { key: "api.compare.versus.previous_period" },
      detailTone: "success",
    });
    // A previous period no longer kept: said, never compared with zeros.
    expect(comparedWith("previous-period", false)).toMatchObject({
      detail: "$api.compare.no_baseline.previous_period",
      detailTone: "neutral",
    });
    const none = comparedWith("none", false);
    expect(none).toMatchObject({ id: "requests", value: 10 });
    expect(none).not.toHaveProperty("detail");
    expect(none).not.toHaveProperty("detailTone");
  });
});
