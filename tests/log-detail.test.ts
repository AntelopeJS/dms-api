import { describe, expect, it, vi } from "vitest";
import { LogsController } from "@/routes/logs";

vi.mock("@antelopejs/interface-database-decorators", async (actual) => ({
  ...(await actual<object>()),
  GetModel: () => ({}),
}));
vi.mock("@/services/request-log/read", () => ({
  getRequestLog: async (_model: unknown, id: string) => ({
    _id: id,
    timestamp: new Date("2026-10-19T10:00:00Z"),
    method: "GET",
    uri: "/api/orders/:id",
    rawPath: "/api/orders/42",
    statusCode: 200,
  }),
  getRouteLatency: async () => null,
}));
vi.mock("@/services/route-catalog", () => ({ findRoute: () => undefined }));
vi.mock("@/services/api-origin", () => ({
  apiOrigin: async () => "http://localhost",
}));

describe("a request opened by its id", () => {
  it("holds the path the panel's title reads, as a listed row does", async () => {
    const detail = await new LogsController().getLog(undefined as never, "r1");
    expect(detail).toMatchObject({
      method: "GET",
      path: "/api/orders/42",
      rawPath: "/api/orders/42",
    });
  });
});
