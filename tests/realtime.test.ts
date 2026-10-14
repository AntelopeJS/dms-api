import { describe, expect, it, vi } from "vitest";

const topics = vi.hoisted(() => [] as Array<[string, string]>);

vi.mock("@antelopejs/interface-dms/realtime", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@antelopejs/interface-dms/realtime")
  >()),
  RegisterPageTopic: (pageId: string, topic: string) => {
    topics.push([pageId, topic]);
  },
}));

import { livePageIds, registerLiveTopics } from "@/realtime";
import { LIVE_REQUESTS_TOPIC } from "@/types";

describe("live topics", () => {
  it("binds the live feed to the Overview, the request logs and Routes", () => {
    registerLiveTopics();
    expect(topics).toEqual(
      livePageIds().map((pageId) => [pageId, LIVE_REQUESTS_TOPIC]),
    );
  });
});
