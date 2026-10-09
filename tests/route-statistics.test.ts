import { describe, expect, it } from "vitest";
import {
  errorRateKpi,
  latencyChart,
  latencyKpi,
  maxLatencyKpi,
  requestsKpi,
  type RouteTraffic,
  statusChart,
} from "@/services/route-statistics";
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
    ...fields,
  };
}

const buckets = [
  bucket(1, {
    requests: 8,
    clientErrors: 1,
    serverErrors: 1,
    totalLatency: 800,
    maxLatency: 300,
    minLatency: 20,
  }),
  bucket(2, {}),
  bucket(3, { requests: 2, totalLatency: 100, maxLatency: 60, minLatency: 40 }),
];

const traffic: RouteTraffic = {
  buckets,
  total: sumBuckets(buckets),
  previous: bucket(0, { requests: 5, totalLatency: 400, maxLatency: 100 }),
};

describe("route statistics", () => {
  it("compares the requests to the previous period", () => {
    expect(requestsKpi(traffic)).toEqual({
      value: 10,
      delta: 100,
      sparkline: [8, 0, 2],
    });
  });

  it("reads latency and error rate off the buckets that saw a call", () => {
    expect(latencyKpi(traffic)).toMatchObject({
      value: 90,
      sparkline: [100, 50],
    });
    expect(errorRateKpi(traffic)).toMatchObject({ value: 20, delta: null });
    expect(maxLatencyKpi(traffic)).toMatchObject({ value: 300, delta: 200 });
  });

  it("splits the requests by status class", () => {
    const chart = statusChart(traffic);
    expect(chart.series.map((series) => series.name)).toEqual([
      "2xx",
      "4xx",
      "5xx",
    ]);
    expect(chart.series[0]?.data[0]).toEqual({ x: 1, y: 6 });
  });

  it("draws latency only where the route was called", () => {
    const chart = latencyChart(traffic);
    expect(chart.series[0]?.data).toEqual([
      { x: 1, y: 100 },
      { x: 3, y: 50 },
    ]);
  });

  it("has nothing to show without a previous period or traffic", () => {
    const empty: RouteTraffic = {
      buckets: [],
      total: sumBuckets([]),
      previous: null,
    };
    expect(requestsKpi(empty)).toEqual({
      value: 0,
      delta: null,
      sparkline: [],
    });
    expect(errorRateKpi(empty).value).toBe(0);
  });
});
