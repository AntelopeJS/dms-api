import { describe, expect, it } from "vitest";
import {
  latencyChart,
  routeSummary,
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
  it("sums up calls, latency, errors and the slowest call", () => {
    const [requests, latency, errors, max] = routeSummary(traffic, 250).items;
    expect(requests).toMatchObject({ value: 10, detailTone: "success" });
    expect(requests?.detail).toMatchObject({
      params: { delta: { value: 1 } },
    });
    expect(latency?.value).toMatchObject({ params: { value: { value: 90 } } });
    expect(errors?.value).toMatchObject({
      params: { rate: { value: 0.2 } },
    });
    expect(errors?.detailTone).toBe("error");
    expect(max).toMatchObject({ tone: "warning", detailTone: "warning" });
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
  });
});
