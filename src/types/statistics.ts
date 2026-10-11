export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface RequestStatistics {
  /** Duration in milliseconds; null when it could not be measured. */
  responseTime: number | null;
  method: HttpMethod;
  uri: string;
  statusCode: number;
}

/**
 * Upper bounds, in milliseconds, of the latency histogram a day rollup keeps:
 * bucket `i` counts the calls that took less than `LATENCY_BUCKETS_MS[i]`
 * (and at least the bound before), the extra last bucket the slower ones. The
 * rollups store the counts, not the bounds: never change them.
 */
export const LATENCY_BUCKETS_MS = [
  5, 10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000,
  10000,
] as const;

export interface DayStatistics {
  /** Timestamp at midnight (ms since epoch) */
  day: number;
  requestsCount: number;
  averageResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  totalResponseTime: number;
  clientErrorsCount: number;
  serverErrorsCount: number;
  /**
   * Calls whose duration was measured: the latency figures are over these.
   * Absent on days written before it existed, where every call was timed.
   */
  timedRequestsCount?: number;
  /**
   * Timed calls per bucket of {@link LATENCY_BUCKETS_MS}, what a p95 is
   * estimated from. Absent on days written before it existed.
   */
  latencyHistogram?: number[];
}
