import type { RequestLogModel } from "@/db";
import { MS_PER_HOUR, MS_PER_MINUTE } from "@/types";
import { addSample, loadSamples, type ScopeKeys, sumBuckets } from "./traffic";

/** One minute of the live histogram. */
export interface LiveBucket {
  start: number;
  success: number;
  clientErrors: number;
  serverErrors: number;
}

export interface LiveTraffic {
  buckets: LiveBucket[];
  total: number;
  clientErrors: number;
  serverErrors: number;
  refreshedAt: string;
}

const LIVE_MINUTES = MS_PER_HOUR / MS_PER_MINUTE;

/** Requests per minute over the last hour, split by status class. */
export async function getLiveTraffic(
  model: RequestLogModel,
  keys: ScopeKeys,
  now: Date = new Date(),
): Promise<LiveTraffic> {
  const end = Math.floor(now.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE;
  const start = end - (LIVE_MINUTES - 1) * MS_PER_MINUTE;
  const samples = await loadSamples(
    model,
    { from: new Date(start), to: now },
    keys,
  );
  const minutes = Array.from({ length: LIVE_MINUTES }, (_, index) => ({
    start: start + index * MS_PER_MINUTE,
    requests: 0,
    clientErrors: 0,
    serverErrors: 0,
    totalLatency: 0,
    maxLatency: 0,
    minLatency: 0,
  }));
  for (const sample of samples) {
    const index = Math.floor(
      (new Date(sample.timestamp).getTime() - start) / MS_PER_MINUTE,
    );
    const bucket = minutes[index];
    if (bucket) addSample(bucket, sample);
  }
  const total = sumBuckets(minutes);
  return {
    buckets: minutes.map((bucket) => ({
      start: bucket.start,
      success: bucket.requests - bucket.clientErrors - bucket.serverErrors,
      clientErrors: bucket.clientErrors,
      serverErrors: bucket.serverErrors,
    })),
    total: total.requests,
    clientErrors: total.clientErrors,
    serverErrors: total.serverErrors,
    refreshedAt: now.toISOString(),
  };
}
