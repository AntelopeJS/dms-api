import { describe, expect, it } from "vitest";
import { canReadLog } from "@/services/request-log/access";

const SCOPE = new Set(["GET:/api/orders"]);
const inScope = { method: "GET" as const, uri: "/api/orders" };
const outOfScope = { method: "GET" as const, uri: "/admin/users" };
const unmatched = { method: "GET" as const, uri: "/nope" };
const testerCall = { ...outOfScope, source: "tester" as const };

describe("canReadLog", () => {
  it("opens every request on the request logs page", () => {
    expect(canReadLog("logs", unmatched, false, SCOPE)).toBe(true);
    expect(canReadLog("logs", outOfScope, true, SCOPE)).toBe(true);
  });

  it("opens only the scope's requests from the Overview", () => {
    expect(canReadLog("overview", inScope, true, SCOPE)).toBe(true);
    expect(canReadLog("overview", outOfScope, true, SCOPE)).toBe(false);
    expect(canReadLog("overview", unmatched, false, null)).toBe(true);
  });

  it("opens only a route's requests of the scope from the Routes page", () => {
    expect(canReadLog("routes", inScope, true, SCOPE)).toBe(true);
    expect(canReadLog("routes", outOfScope, true, SCOPE)).toBe(false);
    expect(canReadLog("routes", unmatched, false, null)).toBe(false);
  });

  it("opens the Tester's own calls, and what the Routes page lists", () => {
    expect(canReadLog("tester", testerCall, true, SCOPE)).toBe(true);
    expect(canReadLog("tester", inScope, true, SCOPE)).toBe(true);
    expect(canReadLog("tester", outOfScope, true, SCOPE)).toBe(false);
    expect(canReadLog("tester", unmatched, false, null)).toBe(false);
  });
});
