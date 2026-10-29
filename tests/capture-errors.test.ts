import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  bodyErrorMessage,
  dmsModuleOf,
  isDmsConsoleCall,
  isDmsConsolePage,
  isInternalTraffic,
  requestIdOf,
  resolveRequestRoute,
} from "@/services/request-log/capture";
import { captureBody, pickHeaders } from "@/services/request-log/util";
import { registerRoutes, routeHandler } from "./helpers/routes";

let ids: string[] = [];

beforeAll(() => {
  ids = registerRoutes(
    routeHandler("get", "/api/orders/"),
    routeHandler("post", "/api/orders/"),
    routeHandler("get", "/api/orders/:id"),
    routeHandler("any", "/webhooks/:provider"),
  );
});

describe("bodyErrorMessage", () => {
  it("reads `error` or `message` from a body object or its JSON", () => {
    expect(bodyErrorMessage({ error: "Cart is empty" })).toBe("Cart is empty");
    expect(bodyErrorMessage('{"message":" Not found "}')).toBe("Not found");
    expect(bodyErrorMessage(Buffer.from('{"error":"Conflict"}'))).toBe(
      "Conflict",
    );
  });

  it("finds nothing in a body without one", () => {
    expect(bodyErrorMessage({ id: 1 })).toBeUndefined();
    expect(bodyErrorMessage("<html>")).toBeUndefined();
    expect(bodyErrorMessage(undefined)).toBeUndefined();
  });
});

describe("resolveRequestRoute", () => {
  it("stores the route path without its trailing slash", () => {
    expect(resolveRequestRoute("GET", "/api/orders")).toMatchObject({
      uri: "/api/orders",
      routeMethod: undefined,
      matched: { id: ids[0] },
    });
  });

  it("puts a HEAD answered by the GET handler on the GET route", () => {
    expect(resolveRequestRoute("HEAD", "/api/orders/42")).toMatchObject({
      method: "HEAD",
      routeMethod: "GET",
      uri: "/api/orders/:id",
      matched: { id: ids[2] },
    });
  });

  it("names the route of a handler on every method", () => {
    expect(resolveRequestRoute("POST", "/webhooks/stripe")).toMatchObject({
      routeMethod: "ANY",
      uri: "/webhooks/:provider",
    });
  });

  it("falls back to the raw path, canonical too, when nothing matches", () => {
    const route = resolveRequestRoute("GET", "/nope/xyz/");
    expect(route.matched).toBeUndefined();
    expect(route.uri).toBe("/nope/xyz");
    expect(route.rawPath).toBe("/nope/xyz/");
  });
});

describe("isDmsConsoleCall", () => {
  const registered = [
    { location: "/dms/permissions", module: "dms" },
    { location: "/api/auth/me", module: "dms" },
    { location: "/api/orders", module: "shop" },
  ];

  it("names the DMS module by its own endpoints", () => {
    expect(dmsModuleOf(registered)).toBe("dms");
    expect(dmsModuleOf([{ location: "/api/orders" }])).toBeUndefined();
  });

  it("leaves out the DMS console's own calls", () => {
    expect(
      isDmsConsoleCall(
        { location: "/api/auth/me", module: "dms" },
        () => registered,
      ),
    ).toBe(true);
    expect(
      isDmsConsoleCall(
        { location: "/settings/user/notifications/counts/" },
        () => registered,
      ),
    ).toBe(true);
  });

  it("keeps an application route on the same path, and every other one", () => {
    expect(
      isDmsConsoleCall(
        { location: "/api/auth/me", module: "shop" },
        () => registered,
      ),
    ).toBe(false);
    expect(
      isDmsConsoleCall(
        { location: "/api/auth/login", module: "dms" },
        () => registered,
      ),
    ).toBe(false);
  });

  it("leaves out the DMS's Settings endpoints and tables, on its handlers only", () => {
    expect(
      isDmsConsoleCall(
        { location: "/settings/user/notifications/list", module: "dms" },
        () => registered,
      ),
    ).toBe(true);
    expect(
      isDmsConsoleCall(
        { location: "/api/tables/members/count/batch", module: "dms" },
        () => registered,
      ),
    ).toBe(true);
    expect(
      isDmsConsoleCall(
        { location: "/api/tables/notes/list", module: "shop" },
        () => registered,
      ),
    ).toBe(false);
    expect(
      isDmsConsoleCall({ location: "/settings/billing" }, () => registered),
    ).toBe(false);
    expect(
      isDmsConsoleCall({ location: "/settings/billing", module: "dms" }, () => [
        { location: "/api/orders", module: "shop" },
      ]),
    ).toBe(false);
    expect(
      isDmsConsoleCall(
        { location: "/settingsx/a", module: "dms" },
        () => registered,
      ),
    ).toBe(false);
  });

  it("reads the handlers for a path of the list only", () => {
    const handlers = vi.fn(() => registered);
    isDmsConsoleCall({ location: "/api/orders", module: "shop" }, handlers);
    expect(handlers).not.toHaveBeenCalled();
  });
});

describe("isInternalTraffic", () => {
  it("leaves out the console, the DMS and page layouts", () => {
    expect(isInternalTraffic("/api/monitoring/logs/live")).toBe(true);
    expect(isInternalTraffic("/api/realtime/subscribe")).toBe(true);
    expect(isInternalTraffic("/dms/permissions")).toBe(true);
    expect(isInternalTraffic("/notes/pagelayout", "/notes/pagelayout")).toBe(
      true,
    );
  });

  it("keeps the API's traffic", () => {
    expect(isInternalTraffic("/api/orders")).toBe(false);
    expect(isInternalTraffic("/api/monitoringx")).toBe(false);
    expect(isInternalTraffic("/dmsx/a")).toBe(false);
  });
});

describe("isDmsConsolePage", () => {
  it("recognizes the loads of the console's pages", () => {
    expect(isDmsConsolePage("GET", "/")).toBe(true);
    expect(isDmsConsolePage("GET", "/modules/api")).toBe(true);
    expect(isDmsConsolePage("get", "/modules/api/logs/")).toBe(true);
    expect(isDmsConsolePage("HEAD", "/auth")).toBe(true);
    expect(isDmsConsolePage("GET", "/home")).toBe(true);
  });

  it("keeps the user's actions and the API's paths", () => {
    expect(isDmsConsolePage("POST", "/api/auth/login")).toBe(false);
    expect(isDmsConsolePage("POST", "/modules/api")).toBe(false);
    expect(isDmsConsolePage("GET", "/api/orders")).toBe(false);
    expect(isDmsConsolePage("GET", "/modulesx")).toBe(false);
    expect(isDmsConsolePage("GET", "/webhooks/stripe")).toBe(false);
  });
});

describe("request marks", () => {
  it("keeps an x-request-id that is short enough to be an id", () => {
    expect(requestIdOf({ "x-request-id": " 3f2c " })).toBe("3f2c");
    expect(requestIdOf({ "x-request-id": "x".repeat(200) })).toBeUndefined();
  });
});

describe("captureBody", () => {
  it("says why a body is not stored", () => {
    expect(captureBody(undefined, "application/json", 1024).omitted).toBe(
      "empty",
    );
    expect(captureBody(Buffer.alloc(0), "application/json", 1024).omitted).toBe(
      "empty",
    );
    expect(captureBody('{"a":1}', "application/json", 0).omitted).toBe(
      "disabled",
    );
    expect(captureBody("%PDF", "application/pdf", 1024).omitted).toBe(
      "not-json",
    );
    expect(captureBody("{oops", "application/json", 1024).omitted).toBe(
      "malformed",
    );
  });

  it("stores a redacted body, cut at the size limit", () => {
    expect(
      captureBody('{"token":"t","sku":"DESK"}', "application/json", 1024),
    ).toEqual({
      body: '{"token":"[REDACTED]","sku":"DESK"}',
      truncated: false,
      redacted: 1,
    });
    expect(captureBody('{"sku":"DESK"}', "application/json", 5)).toEqual({
      body: '{"sku',
      truncated: true,
      redacted: 0,
      // The whole body's bytes, for "5 B of 14 B".
      size: 14,
    });
  });

  it("cuts a multi-byte body at the limit in bytes, between characters", () => {
    // `{"n":"` is 6 bytes, each "é" 2: 9 bytes end inside the second one.
    const captured = captureBody('{"n":"ééééé"}', "application/json", 9);
    expect(captured.body).toBe('{"n":"é');
    expect(Buffer.byteLength(captured.body ?? "")).toBeLessThanOrEqual(9);
    expect(captured).toMatchObject({ truncated: true, size: 18 });
  });
});

describe("pickHeaders", () => {
  it("keeps the allow-listed headers and names the secret ones it drops", () => {
    const dropped: string[] = [];
    expect(
      pickHeaders(
        {
          "Content-Type": "application/json",
          Authorization: "Bearer x",
          "x-other": "1",
        },
        ["content-type", "authorization"],
        dropped,
      ),
    ).toEqual({ "content-type": "application/json" });
    expect(dropped).toEqual(["authorization"]);
  });
});
