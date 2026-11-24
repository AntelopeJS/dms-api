import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callRouteActionOf } from "@/automation/call-route";
import {
  callableRoute,
  fillPath,
  prepareRouteCall,
  readCapped,
} from "@/services/route-call";
import {
  patternMatches,
  reachesRefusedRoute,
} from "@/services/route-call-reach";
import {
  registerRoutes,
  routeHandler,
  unregisterRoutes,
} from "./helpers/routes";

const origin = () => Promise.resolve("https://api.example.com");
const CTX = {
  procedureId: "p",
  runId: "run1",
  nodeId: "node1",
  log: () => undefined,
};

beforeAll(() => {
  registerRoutes(
    routeHandler("get", "/api/:resource/:id"),
    routeHandler("get", "/:area/:page"),
    routeHandler("get", "/api/pages/:page/:leaf"),
    routeHandler("get", "/api/monitoring/settings"),
    routeHandler("post", "/api/automation/procedures"),
    routeHandler("get", "/settings/profile"),
    routeHandler("get", "/api/tables/:table"),
    routeHandler("post", "/api/auth/password"),
    routeHandler("post", "/api/onboarding/informations"),
    routeHandler("get", "/api/me"),
    routeHandler("get", "/files/file.:ext"),
    routeHandler("get", "/static/::rest"),
  );
});

afterAll(unregisterRoutes);

describe("a filled path reaching a refused route", () => {
  it("refuses parameters that make an open route's URL the console's, the DMS's or the automation API's", async () => {
    const refused: Array<[string, Record<string, string>]> = [
      ["GET /api/:resource/:id", { resource: "monitoring", id: "settings" }],
      ["GET /api/:resource/:id", { resource: "tables", id: "users" }],
      ["GET /:area/:page", { area: "dms", page: "anything" }],
      ["GET /:area/:page", { area: "settings", page: "profile" }],
      ["GET /api/pages/:page/:leaf", { page: "home", leaf: "pagelayout" }],
    ];
    for (const [route, pathParams] of refused) {
      await expect(
        prepareRouteCall({ route, pathParams }, "r", origin),
        JSON.stringify(pathParams),
      ).rejects.toThrow(/internal route/);
    }
    const call = await prepareRouteCall(
      {
        route: "GET /api/:resource/:id",
        pathParams: { resource: "orders", id: "42" },
      },
      "r",
      origin,
    );
    expect(call.url).toBe("https://api.example.com/api/orders/42");
  });

  it("reads an encoded slash both as sent and decoded", () => {
    expect(reachesRefusedRoute("/api/monitoring%2Fsettings")).toBe(true);
    expect(reachesRefusedRoute("/api/x/a%2Fb")).toBe(false);
  });

  it("matches the patterns a router could pick: dynamic, composite and catch-all parts", () => {
    expect(patternMatches("/api/:a/:b", ["api", "x", "y"])).toBe(true);
    expect(patternMatches("/files/file.:ext", ["files", "notes.txt"])).toBe(
      true,
    );
    expect(patternMatches("/static/::rest", ["static", "a", "b"])).toBe(true);
    expect(patternMatches("/static/::rest", ["static"])).toBe(false);
    expect(patternMatches("/api/:a", ["api", "x", "y"])).toBe(false);
  });
});

describe("routes a procedure may not name", () => {
  it("refuses the DMS's Settings, tables, account and onboarding routes when their module cannot be told", () => {
    for (const ref of [
      "GET /settings/profile",
      "GET /api/tables/:table",
      "POST /api/auth/password",
      "POST /api/onboarding/informations",
      "POST /api/automation/procedures",
    ]) {
      expect(() => callableRoute(ref), ref).toThrow(/internal route/);
    }
    expect(callableRoute("GET /api/me").ref).toBe("GET /api/me");
  });

  it("refuses a route it cannot fill: a composite or a catch-all segment", () => {
    expect(() => fillPath("/files/file.:ext", { ext: "txt" })).toThrow(
      /cannot be filled/,
    );
    expect(() => fillPath("/static/::rest", { rest: "a" })).toThrow(
      /cannot be filled/,
    );
  });
});

describe("unset inputs of api.call-route", () => {
  it("calls anonymously with an empty or null credential, and sends no body for a null one", async () => {
    const sent: Headers[] = [];
    const callRoute = callRouteActionOf({
      refresh: () => Promise.resolve(),
      origin,
      send: (_url, init) => {
        sent.push(new Headers(init?.headers));
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    });
    for (const credential of ["", null]) {
      const output = await callRoute.execute(
        { route: "GET /api/me", credential, body: null },
        CTX,
      );
      expect(output).toMatchObject({ ok: true, statusCode: 204 });
    }
    expect(sent.map((headers) => headers.get("content-type"))).toEqual([
      null,
      null,
    ]);
  });
});

describe("readCapped", () => {
  it("stops reading at the cap and cancels the rest of the stream", async () => {
    let pulls = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new TextEncoder().encode("x".repeat(1000)));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { text, truncated } = await readCapped(new Response(endless), 2500);
    expect([text.length, truncated, cancelled]).toEqual([2500, true, true]);
    expect(pulls).toBeLessThan(6);
  });

  it("reads a short body whole", async () => {
    expect(await readCapped(new Response("short"), 2500)).toEqual({
      text: "short",
      truncated: false,
    });
  });
});
