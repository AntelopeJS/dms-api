import { ImplementInterface } from "@antelopejs/interface-core";
import { internal } from "@antelopejs/interface-dms/realtime";
import { describe, expect, it } from "vitest";
import { livePageIds, registerLiveTopics } from "@/realtime";
import { LIVE_REQUESTS_TOPIC } from "@/types";

const topics: Array<[string, string]> = [];

ImplementInterface(
  { internal: { RegisterPageTopic: internal.RegisterPageTopic } },
  {
    internal: {
      RegisterPageTopic: {
        register: (_id: string, pageId: string, topic: string) => {
          topics.push([pageId, topic]);
        },
        unregister: () => undefined,
      },
    },
  },
);

describe("live topics", () => {
  it("binds the live feed to the Overview, the request logs and Routes", () => {
    topics.length = 0;
    registerLiveTopics();
    expect(topics).toEqual(
      livePageIds().map((pageId) => [pageId, LIVE_REQUESTS_TOPIC]),
    );
    expect(topics.map(([pageId]) => pageId)).toEqual([
      "modules.api.monitor.overview",
      "modules.api.monitor.logs",
      "modules.api.explore.routes",
    ]);
  });
});
