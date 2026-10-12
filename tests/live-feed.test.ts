import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { recordLiveRequest } from "@/services/live-feed";
import { LIVE_REQUESTS_TOPIC } from "@/types";

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 10, 12, 0, seconds));

beforeEach(() => {
  published.length = 0;
});

describe("recordLiveRequest", () => {
  it("publishes the request on the live topic at once", () => {
    recordLiveRequest({ timestamp: at(1), statusCode: 500, tester: false });
    expect(published).toEqual([
      {
        topic: LIVE_REQUESTS_TOPIC,
        type: "requests",
        payload: {
          timestamp: at(1).toISOString(),
          statusCode: 500,
          tester: false,
        },
      },
    ]);
  });

  it("publishes one message per request of a burst, for a paused page to count them all", () => {
    for (let index = 0; index < 40; index++) {
      recordLiveRequest({
        timestamp: at(index),
        statusCode: 200,
        tester: false,
      });
    }
    expect(published).toHaveLength(40);
  });
});
