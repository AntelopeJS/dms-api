import { describe, expect, it } from "vitest";
import type { RequestLog } from "@/db/tables/request_log.table";
import { filtersFromQuery, toRow } from "@/services/request-log/list";
import { MS_PER_HOUR } from "@/types";

const NOW = new Date("2026-10-07T15:00:00.000Z");

describe("filtersFromQuery", () => {
  it("reads the tab, the quick filters and the search", () => {
    const filters = filtersFromQuery(
      {
        filter_statusClass: "is:5xx",
        filter_method: "is:POST",
        filter_slow: "is:true",
        filter_window: "is:1h",
        search: "  stripe ",
      },
      NOW,
    );
    expect(filters).toMatchObject({
      statusClass: "server-error",
      method: "POST",
      slowThresholdMs: 1000,
      search: "stripe",
    });
    expect(filters.since).toEqual(new Date(NOW.getTime() - MS_PER_HOUR));
  });

  it("narrows to a route named `METHOD /path`", () => {
    expect(
      filtersFromQuery({ filter_route: "is:POST /webhooks/stripe" }),
    ).toMatchObject({ method: "POST", uri: "/webhooks/stripe" });
  });

  it("keeps the colons of an error message", () => {
    expect(
      filtersFromQuery({
        filter_error: "is:TypeError: Cannot read properties of null",
      }).errorMessage,
    ).toBe("TypeError: Cannot read properties of null");
  });

  it("ignores values it does not know", () => {
    expect(
      filtersFromQuery({
        filter_statusClass: "is:6xx",
        filter_window: "is:1y",
        filter_route: "is:nonsense",
        filter_slow: "is:false",
      }),
    ).toEqual({});
  });
});

describe("toRow", () => {
  it("names the route, the status class and slowness of a request", () => {
    const row = toRow({
      _id: "req_1",
      timestamp: NOW,
      method: "GET",
      uri: "/api/invoices/:id/pdf",
      rawPath: "/api/invoices/INV-1/pdf",
      statusCode: 404,
      responseTimeMs: 1500.4,
      error: { message: "Invoice not found" },
    } as RequestLog);
    expect(row).toMatchObject({
      route: "GET /api/invoices/:id/pdf",
      path: "/api/invoices/INV-1/pdf",
      status: "404",
      statusClass: "4xx",
      responseTimeMs: 1500,
      slow: true,
      error: "Invoice not found",
    });
  });
});
