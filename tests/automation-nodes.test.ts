import { describe, expect, it } from "vitest";
import { requestLogEntry } from "@/automation/query-request-logs";
import type { RequestLog } from "@/db/tables/request_log.table";

const FIELDS = {
  _id: "r1",
  method: "POST",
  uri: "/api/orders/:id",
  rawPath: "/api/orders/42",
  pathParams: { id: "42" },
  query: { tag: ["a", "b"] },
  requestHeaders: { "content-type": "application/json" },
  requestBodyTruncated: false,
  statusCode: 500,
  responseTimeMs: null,
  responseHeaders: {},
  responseBodyTruncated: false,
  redactions: { query: 0, requestBody: 1, responseBody: 0, headers: [] },
  error: { message: "boom" },
};

const STORED: RequestLog = {
  ...FIELDS,
  timestamp: new Date("2026-10-19T10:00:00.000Z"),
};

describe("the Query request logs action", () => {
  it("hands a stored log on as JSON, its timestamp an ISO string", () => {
    expect(requestLogEntry(STORED)).toEqual({
      ...FIELDS,
      timestamp: "2026-10-19T10:00:00.000Z",
    });
  });
});
