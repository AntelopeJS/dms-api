import { describe, expect, it } from "vitest";
import {
  errorRateChart,
  latencyChart,
  routeSummary,
  type RouteTraffic,
} from "@/services/route-statistics";
import {
  emptyHistogram,
  latencyBucketIndex,
} from "@/services/statistics-utils";
import { sumBuckets, type TrafficBucket } from "@/services/traffic";

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
};

describe("route statistics", () => {
  it("sums up calls, latency with its p95, errors and the slowest call", () => {
    const [requests, latency, errors, max] = routeSummary(traffic, 250).items;
    expect(requests).toMatchObject({ value: 10, detailTone: "success" });
    expect(requests?.detail).toMatchObject({
      params: { delta: { value: 1 } },
    });
    expect(latency?.value).toMatchObject({ params: { value: { value: 90 } } });
    // The p95 under the average, not the minimum.
    expect(latency?.detail).toMatchObject({
      key: "api.routes.statistics.p95_detail",
    });
    expect(errors?.value).toMatchObject({
      params: { rate: { value: 0.2 } },
    });
    expect(errors?.detail).toMatchObject({
      params: { client: { value: 1 }, server: { value: 1 } },
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
    expect(latency?.detail).toBe("$api.routes.statistics.p95_none");
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
    expect(chart.slowThresholdMs).toBe(1000);
    // Every p95 point within its bucket's max.
    expect(chart.series[2]?.data[0]?.y).toBeLessThanOrEqual(300);
  });

  it("sizes the axis to hold the slow threshold, above or below the points", () => {
    expect(latencyChart(traffic, 1000)).toMatchObject({ yMin: 0, yMax: 1100 });
    expect(latencyChart(traffic, 100).yMax).toBe(400);
  });

  it("says when there is no previous period", () => {
    const empty: RouteTraffic = {
      buckets: [],
      total: sumBuckets([]),
      previous: null,
    };
    const [requests, , errors] = routeSummary(empty, 250).items;
    expect(requests).toMatchObject({
      value: 0,
      detail: "$api.routes.statistics.no_baseline",
      detailTone: "neutral",
    });
    expect(errors?.tone).toBe("muted");
    expect(errorRateChart(empty)).toMatchObject({ value: 0, delta: null });
  });
});
