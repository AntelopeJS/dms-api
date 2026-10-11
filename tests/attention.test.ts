import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RequestLogFilters,
  RequestLogSample,
} from "@/db/models/request_log.model";
import { clearAggregateCache } from "@/services/aggregate-cache";
import { getAttention } from "@/services/attention";
import { forgetRecentScan, type SampleSource } from "@/services/traffic";
import { pinnedNow } from "@/services/window";
import { MS_PER_MINUTE } from "@/types";

const registered = vi.hoisted(() => ({
  handlers: [] as Array<{ id: string; handler: Record<string, unknown> }>,
}));

vi.mock("@antelopejs/interface-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@antelopejs/interface-api")>()),
  getRegisteredRouteHandlers: () => registered.handlers,
}));

/** A whole minute, so the 15-minute window is exactly the last 15 minutes. */
const NOW = new Date(
  Math.floor(pinnedNow().getTime() / MS_PER_MINUTE) * MS_PER_MINUTE,
);

function call(
  minutesAgo: number,
  statusCode = 200,
  uri = "/orders",
): RequestLogSample {
  return {
    timestamp: new Date(NOW.getTime() - minutesAgo * MS_PER_MINUTE),
    method: "POST",
    uri,
    statusCode,
    responseTimeMs: 40,
  };
}

function modelsOf(rows: RequestLogSample[]): { logs: SampleSource } {
  return {
    logs: {
      samples: async ({ since, until }: RequestLogFilters) =>
        rows.filter(
          (row) =>
            (!since || row.timestamp >= since) &&
            (!until || row.timestamp < until),
        ),
    },
  };
}

beforeEach(() => {
  clearAggregateCache();
  forgetRecentScan();
  registered.handlers = [];
});

describe("getAttention", () => {
  it("gives a failing route's rate over the window its state was judged on", async () => {
    // A busy day with a few 5xx, under 1 % over 24 h; 3 of the last 15
    // minutes' 60 calls fail.
    const rows = [
      ...Array.from({ length: 1400 }, (_, index) => call(15.5 + index)),
      ...Array.from({ length: 57 }, (_, index) => call(0.1 + index * 0.25)),
      call(2, 500),
      call(4, 500),
      call(6, 500),
    ];
    const { items } = await getAttention(modelsOf(rows), null, 8, NOW);
    const [route] = items;
    expect(route?.state).toBe("failing");
    expect(route?.metrics.serverErrorRate).toBe(0.2);
    expect(route?.stateWindow).toMatchObject({
      minutes: 15,
      requests: 60,
      serverErrors: 3,
      serverErrorRate: 5,
    });
    expect(route?.params).toMatchObject({
      windowRate: "5",
      windowCalls: "60",
      windowMinutes: "15",
    });
  });

  it("gives a recovered route its last 5xx, the burst left behind", async () => {
    // A burst of 5xx on a route called rarely, 20 minutes ago, then calm.
    const rows = [
      ...Array.from({ length: 30 }, (_, index) => call(20 + index * 0.02, 500)),
      call(10),
      call(3),
    ];
    const { items } = await getAttention(modelsOf(rows), null, 8, NOW);
    const [route] = items;
    expect(route?.state).toBe("recovered");
    const last = new Date(NOW.getTime() - 20 * MS_PER_MINUTE).toISOString();
    expect(route?.lastServerError).toBe(last);
    expect(route?.params?.lastServerError).toBe(last);
  });

  it("puts the registered routes first and marks the stray paths", async () => {
    registered.handlers = [
      {
        id: "1",
        handler: { mode: "handler", method: "post", location: "/orders" },
      },
    ];
    // A stray path failing outright, a registered route with 4xx only: the
    // route keeps its place within the cap.
    const rows = [
      ...Array.from({ length: 30 }, (_, index) =>
        call(index * 0.3, 500, "/.env"),
      ),
      ...Array.from({ length: 30 }, (_, index) => call(index * 0.3, 404)),
    ];
    const { items, total } = await getAttention(modelsOf(rows), null, 1, NOW);
    expect(total).toBe(2);
    expect(items.map(({ route, known }) => ({ route, known }))).toEqual([
      { route: "POST /orders", known: true },
    ]);
    const all = await getAttention(modelsOf(rows), null, 8, NOW);
    expect(all.items.map(({ known }) => known)).toEqual([true, false]);
  });
});
