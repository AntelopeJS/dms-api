import { describe, expect, it } from "vitest";
import {
  countTabs,
  pathEncoded,
  requestIdPrefix,
  searchPattern,
} from "@/db/models/request_log.model";
import {
  getRouteStatsKey,
  normalizeRoutePath,
} from "@/db/tables/routes_statistics.table";
import { scopeRouteKey } from "@/services/scope";

describe("requestIdPrefix", () => {
  it("reads a request id or its first digits as an id", () => {
    expect(requestIdPrefix("60035cef")).toBe("60035cef");
    expect(requestIdPrefix(" 60035CEF-4a ")).toBe("60035cef-4a");
    expect(requestIdPrefix("2d2bcb1e-f683-4c0e-b730-3b9d2f3147ea")).toBe(
      "2d2bcb1e-f683-4c0e-b730-3b9d2f3147ea",
    );
  });

  it("leaves other searches to the text search", () => {
    expect(requestIdPrefix("6003")).toBeUndefined();
    expect(requestIdPrefix("INV-2248")).toBeUndefined();
    expect(requestIdPrefix("60035cefa")).toBeUndefined();
    expect(requestIdPrefix("/api/orders")).toBeUndefined();
  });
});

describe("unicode search", () => {
  it("encodes a search the way a stored path is", () => {
    expect(pathEncoded("commande-é")).toBe("commande-%C3%A9");
    expect(pathEncoded("😀")).toBe("%F0%9F%98%80");
    expect(pathEncoded("/api/orders")).toBe("/api/orders");
  });

  it("matches the search as typed or as stored", () => {
    expect(searchPattern("orders")).toBe("(?i)orders");
    expect(searchPattern("é.")).toBe("(?i)(?:é\\.|%C3%A9\\.)");
    const pattern = new RegExp(searchPattern("commande-é").slice(4), "i");
    expect(pattern.test("/api/orders/commande-%C3%A9%F0%9F%98%80")).toBe(true);
    expect(pattern.test("/api/orders/commande-é")).toBe(true);
  });
});

describe("countTabs", () => {
  it("sums the status codes of each tab", () => {
    expect(
      countTabs(
        new Map([
          [200, 5],
          [304, 1],
          [404, 2],
          [422, 1],
          [500, 3],
          [101, 1],
        ]),
      ),
    ).toEqual({ all: 13, "2xx": 6, "4xx": 3, "5xx": 3 });
  });
});

describe("canonical route paths", () => {
  it("drops the trailing slash, except for the root", () => {
    expect(normalizeRoutePath("/api/orders/")).toBe("/api/orders");
    expect(normalizeRoutePath("/api/orders//")).toBe("/api/orders");
    expect(normalizeRoutePath("/api/orders")).toBe("/api/orders");
    expect(normalizeRoutePath("/")).toBe("/");
    expect(normalizeRoutePath("//")).toBe("/");
  });

  it("keys a route the same with or without it", () => {
    expect(getRouteStatsKey("get", "/api/orders/")).toBe("GET:/api/orders");
    expect(scopeRouteKey("GET", "/api/orders/")).toBe(
      scopeRouteKey("GET", "/api/orders"),
    );
  });
});
