import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const published = vi.hoisted(
  () => [] as Array<{ topic: string; type: string; payload: unknown }>,
);

vi.mock("@antelopejs/interface-dms/realtime", () => ({
  PublishMessage: vi.fn(
    (topic: string, type: string, options?: { payload?: unknown }) => {
      published.push({ topic, type, payload: options?.payload });
      return Promise.resolve();
    },
  ),
}));

import {
  createLiveBatcher,
  type LiveBatch,
  recordLiveRequest,
  stopLiveFeed,
} from "@/services/live-feed";
import { LIVE_BATCH_MS, LIVE_REQUESTS_TOPIC } from "@/types";

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 10, 12, 0, seconds));

beforeEach(() => {
  vi.useFakeTimers();
  published.length = 0;
});
afterEach(() => {
  stopLiveFeed();
  vi.useRealTimers();
});

describe("createLiveBatcher", () => {
  it("publishes a burst once, after the interval, with its counts", () => {
    const batches: LiveBatch[] = [];
    const batcher = createLiveBatcher((batch) => batches.push(batch), 1_000);
    batcher.add({ timestamp: at(1), statusCode: 200, tester: false });
    batcher.add({ timestamp: at(3), statusCode: 503, tester: false });
    batcher.add({ timestamp: at(2), statusCode: 500, tester: false });
    batcher.add({ timestamp: at(4), statusCode: 201, tester: true });
    vi.advanceTimersByTime(999);
    expect(batches).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(batches).toEqual([
      {
        count: 3,
        server5xx: 2,
        tester: 1,
        lastTimestamp: at(4).toISOString(),
      },
    ]);
  });

  it("never publishes more than once per interval under steady traffic", () => {
    const batches: LiveBatch[] = [];
    const batcher = createLiveBatcher((batch) => batches.push(batch), 1_500);
    // One request every 100 ms for 6 s.
    for (let tick = 0; tick < 60; tick++) {
      batcher.add({ timestamp: at(tick), statusCode: 200, tester: false });
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(1_500);
    expect(batches.length).toBe(4);
    expect(batches.reduce((sum, batch) => sum + batch.count, 0)).toBe(60);
  });

  it("stays quiet without traffic, and drops what waits when stopped", () => {
    const batches: LiveBatch[] = [];
    const batcher = createLiveBatcher((batch) => batches.push(batch), 1_000);
    batcher.flush();
    batcher.add({ timestamp: at(1), statusCode: 200, tester: false });
    batcher.stop();
    vi.advanceTimersByTime(5_000);
    expect(batches).toEqual([]);
  });
});

describe("recordLiveRequest", () => {
  it("publishes the batch on the live topic", () => {
    recordLiveRequest({ timestamp: at(1), statusCode: 500, tester: false });
    vi.advanceTimersByTime(LIVE_BATCH_MS);
    expect(published).toEqual([
      {
        topic: LIVE_REQUESTS_TOPIC,
        type: "requests",
        payload: {
          count: 1,
          server5xx: 1,
          tester: 0,
          lastTimestamp: at(1).toISOString(),
        },
      },
    ]);
  });
});
