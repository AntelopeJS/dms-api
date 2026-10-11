import { beforeEach, describe, expect, it } from "vitest";
import type {
  RequestLogFilters,
  RequestLogSample,
} from "@/db/models/request_log.model";
import {
  type ActivityModels,
  findIncidents,
  getActivity,
  type IncidentItem,
} from "@/services/activity";
import { clearAggregateCache } from "@/services/aggregate-cache";
import { MS_PER_MINUTE } from "@/types";

const NOW = new Date("2026-10-07T12:00:00.000Z").getTime();

function error(
  minutesAgo: number,
  uri = "/hook",
  message = "TypeError",
): RequestLogSample {
  return {
    timestamp: new Date(NOW - minutesAgo * MS_PER_MINUTE),
    method: "POST",
    uri,
    statusCode: 500,
    responseTimeMs: 20,
    errorMessage: message,
  };
}

describe("findIncidents", () => {
  it("starts a new incident after 15 quiet minutes, newest first", () => {
    const incidents = findIncidents(
      [
        error(200),
        error(199),
        error(199.5, "/hook", "Timeout"),
        error(5),
        error(2),
      ],
      NOW,
    );
    expect(incidents).toHaveLength(2);
    const [latest, earlier] = incidents;
    expect(latest.ongoing).toBe(true);
    expect(latest.serverErrors).toBe(2);
    expect(earlier.ongoing).toBe(false);
    expect(earlier.start).toEqual(new Date(NOW - 200 * MS_PER_MINUTE));
    expect(earlier.end).toEqual(new Date(NOW - 199 * MS_PER_MINUTE));
    expect(earlier.peakPerMinute).toBe(2);
    expect(earlier.topError).toMatchObject({ status: 500, count: 2 });
  });

  it("keeps routes apart and leaves anything under 500 out", () => {
    const incidents = findIncidents(
      [
        error(10, "/a"),
        error(10, "/b"),
        { ...error(9, "/a"), statusCode: 404 },
      ],
      NOW,
    );
    expect(incidents.map((incident) => incident.route).sort()).toEqual([
      "POST /a",
      "POST /b",
    ]);
  });
});

describe("getActivity", () => {
  beforeEach(() => clearAggregateCache());

  function modelsOf(rows: RequestLogSample[]): ActivityModels {
    return {
      logs: {
        samples: async ({ since, until }: RequestLogFilters) =>
          rows.filter(
            (row) =>
              (!since || row.timestamp >= since) &&
              (!until || row.timestamp < until),
          ),
      },
      routes: { getAll: async () => [] },
    };
  }

  it("links each incident to its own requests, with its end and top error", async () => {
    const rows = [
      error(130.5, "/hook", "Timeout"),
      error(130),
      error(129.2),
      error(3),
    ];
    const { items } = await getActivity(modelsOf(rows), null, new Date(NOW));
    const [ongoing, closed] = items as IncidentItem[];
    expect(ongoing.incident.endedAt).toBeNull();
    expect(closed.incident.end).toBe(
      new Date(NOW - 129.2 * MS_PER_MINUTE).toISOString(),
    );
    expect(closed.incident.endedAt).toBe(
      new Date(NOW - (129.2 - 15) * MS_PER_MINUTE).toISOString(),
    );
    const link = new URL(closed.to ?? "", "http://console");
    // Whole minutes from the first 5xx to the last, the route's 5xx only.
    expect(link.searchParams.get("since")).toBe(
      new Date(NOW - 131 * MS_PER_MINUTE).toISOString(),
    );
    expect(link.searchParams.get("until")).toBe(
      new Date(NOW - 129 * MS_PER_MINUTE).toISOString(),
    );
    expect(link.searchParams.get("route")).toBe("POST /hook");
    expect(link.searchParams.get("requests.tab")).toBe("5xx");
    expect(link.searchParams.get("api.period")).toBe("last-24h");
    expect(closed.params).toMatchObject({
      topStatus: "500",
      topMessage: "TypeError",
      topCount: "2",
    });
    expect(closed.meta).toContain("$api.overview.activity.incident_top_error");
  });
});
