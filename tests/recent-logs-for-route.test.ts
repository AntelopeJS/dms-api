import { expect, it, vi } from "vitest";
import type { RequestLogFilters } from "@/db/models/request_log.model";
import { getRecentLogsForRoute } from "@/services/request-log/read";

it("looks recent logs up by method and URI pattern, not by route id", async () => {
  const query = vi.fn((_filters: RequestLogFilters) =>
    Promise.resolve({ results: [], nextCursor: null }),
  );

  await getRecentLogsForRoute({ query }, "get", "/api/items/:id", 20);

  expect(query).toHaveBeenCalledWith({
    method: "get",
    uri: "/api/items/:id",
    limit: 20,
  });
  expect(query.mock.calls[0][0]).not.toHaveProperty("routeId");
});
