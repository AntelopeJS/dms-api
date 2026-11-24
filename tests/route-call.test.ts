import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { callRouteActionOf } from "@/automation/call-route";
import { setConfig } from "@/config";
import {
  automationConfigErrors,
  callableRoute,
  fillPath,
  type PreparedRouteCall,
  prepareRouteCall,
  sendRouteCall,
} from "@/services/route-call";
import { requestSource } from "@/services/tester-source";
import {
  registerRoutes,
  routeHandler,
  unregisterRoutes,
} from "./helpers/routes";

let origin: string | null = null;
const readOrigin = () => Promise.resolve(origin);

const SOURCE_HEADER = "x-antelopejs-api-source";
const CTX = {
  procedureId: "p",
  runId: "run1",
  nodeId: "node1",
  log: () => undefined,
};

beforeAll(() => {
  registerRoutes(
    routeHandler("get", "/api/orders/:id"),
    routeHandler("post", "/api/orders"),
    routeHandler("get", "/api/monitoring/overview/health"),
    routeHandler("get", "/dms/fixture"),
    routeHandler("get", "/api/automation/runs"),
    routeHandler("get", "/api/pages/home/pagelayout"),
  );
});

afterAll(unregisterRoutes);

afterEach(() => {
  setConfig({});
  origin = null;
});

describe("callableRoute", () => {
  it("resolves a registered route by its method and canonical path", () => {
    expect(callableRoute("get /api/orders/:id/")).toEqual({
      method: "GET",
      path: "/api/orders/:id",
      ref: "GET /api/orders/:id",
    });
  });

  it("refuses a path no route answers, the console, the DMS, the automation API and page layouts", () => {
    expect(() => callableRoute("DELETE /api/orders/:id")).toThrow(
      /No registered route/,
    );
    for (const ref of [
      "GET /api/monitoring/overview/health",
      "GET /dms/fixture",
      "GET /api/automation/runs",
      "GET /api/pages/home/pagelayout",
    ]) {
      expect(() => callableRoute(ref), ref).toThrow(/internal route/);
    }
  });
});

describe("fillPath", () => {
  it("encodes each path parameter in its segment", () => {
    expect(fillPath("/api/orders/:id", { id: "a b/c" })).toBe(
      "/api/orders/a%20b%2Fc",
    );
  });

  it("refuses a missing, empty, inherited or dot value", () => {
    expect(() => fillPath("/api/orders/:id", {})).toThrow(/pathParams.id/);
    expect(() => fillPath("/api/orders/:id", { id: "" })).toThrow();
    expect(() => fillPath("/api/:constructor", {})).toThrow();
    expect(() => fillPath("/api/orders/:id", { id: ".." })).toThrow(/\.\./);
  });
});

describe("prepareRouteCall", () => {
  it("calls the DMS API origin anonymously, marked as the automation's, with its request id", async () => {
    origin = "https://api.example.com";
    const call = await prepareRouteCall(
      {
        route: "GET /api/orders/:id",
        pathParams: { id: "42" },
        query: { tag: ["a", "b"] },
      },
      "auto-run1-node1",
      readOrigin,
    );
    expect(call.url).toBe("https://api.example.com/api/orders/42?tag=a&tag=b");
    expect(call.headers.get("authorization")).toBeNull();
    expect(call.headers.get("cookie")).toBeNull();
    expect(call.headers.get("x-request-id")).toBe("auto-run1-node1");
    expect(
      requestSource({ [SOURCE_HEADER]: call.headers.get(SOURCE_HEADER) ?? "" }),
    ).toBe("automation");
    expect(call.logsPath).toBe(
      "/modules/api/logs?requestId=auto-run1-node1&requests.tab=all",
    );
  });

  it("sends a named profile's headers, and the configured origin over the DMS's", async () => {
    setConfig({
      automationCallBaseUrl: "http://internal:5010/",
      automationCredentials: {
        ops: { headers: { authorization: "Bearer s" } },
      },
    });
    origin = "https://api.example.com";
    const call = await prepareRouteCall(
      { route: "POST /api/orders", credential: "ops", body: { a: 1 } },
      "r",
      readOrigin,
    );
    expect(call.url).toBe("http://internal:5010/api/orders");
    expect(call.headers.get("authorization")).toBe("Bearer s");
    expect(call.headers.get("content-type")).toBe("application/json");
    expect(call.body).toBe('{"a":1}');
  });

  it("refuses an unknown profile, a body on a GET, an oversized body and a missing origin", async () => {
    origin = "https://api.example.com";
    await expect(
      prepareRouteCall(
        { route: "POST /api/orders", credential: "toString" },
        "r",
        readOrigin,
      ),
    ).rejects.toThrow(/credential profile/);
    await expect(
      prepareRouteCall(
        { route: "GET /api/orders/:id", pathParams: { id: "1" }, body: {} },
        "r",
        readOrigin,
      ),
    ).rejects.toThrow(/takes no body/);
    await expect(
      prepareRouteCall(
        { route: "POST /api/orders", body: "x".repeat(70_000) },
        "r",
        readOrigin,
      ),
    ).rejects.toThrow(/65536 bytes/);
    origin = null;
    await expect(
      prepareRouteCall({ route: "POST /api/orders" }, "r", readOrigin),
    ).rejects.toThrow(/automationCallBaseUrl/);
  });
});

const CALL: PreparedRouteCall = {
  method: "GET",
  route: "GET /api/orders/:id",
  url: "https://api.example.com/api/orders/1",
  headers: new Headers(),
  body: undefined,
  timeoutMs: 100,
  requestId: "r",
  logsPath: "",
};

function answering(response: Response): typeof fetch {
  return () => Promise.resolve(response);
}

describe("sendRouteCall", () => {
  it("returns no body unless asked, and a JSON body parsed when asked", async () => {
    const json = () =>
      new Response('{"ok":1}', {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    expect(await sendRouteCall(CALL, false, answering(json()))).toMatchObject({
      ok: true,
      statusCode: 201,
      body: null,
      bodyTruncated: false,
      contentType: "application/json",
    });
    expect((await sendRouteCall(CALL, true, answering(json()))).body).toEqual({
      ok: 1,
    });
  });

  it("cuts a body over 16384 characters", async () => {
    const result = await sendRouteCall(
      CALL,
      true,
      answering(new Response("y".repeat(20_000), { status: 500 })),
    );
    expect(result).toMatchObject({ ok: false, bodyTruncated: true });
    expect(String(result.body)).toHaveLength(16_384);
  });

  it("answers a timeout with no status", async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        );
      });
    const result = await sendRouteCall(CALL, false, hang);
    expect(result).toMatchObject({
      ok: false,
      statusCode: null,
      error: "Timed out after 100 ms",
    });
  });
});

describe("api.call-route", () => {
  function action(answer: () => Promise<Response>) {
    const sent: Array<{ url: string; headers: Headers }> = [];
    const send: typeof fetch = (url, init) => {
      sent.push({ url: String(url), headers: new Headers(init?.headers) });
      return answer();
    };
    return {
      sent,
      action: callRouteActionOf({
        refresh: () => Promise.resolve(),
        origin: readOrigin,
        send,
      }),
    };
  }

  it("simulates in a test run: checks everything, calls nothing", async () => {
    origin = "https://api.example.com";
    const { sent, action: callRoute } = action(() =>
      Promise.resolve(new Response("{}")),
    );
    const output = await callRoute.dryRun?.(
      { route: "GET /api/orders/:id", pathParams: { id: "1" } },
      { ...CTX, dryRun: true },
    );
    expect(sent).toEqual([]);
    expect(output).toMatchObject({
      ok: true,
      dryRun: true,
      requestId: "auto-run1-node1",
      body: null,
    });
    await expect(
      callRoute.dryRun?.(
        { route: "GET /api/orders/:id" },
        { ...CTX, dryRun: true },
      ),
    ).rejects.toThrow(/pathParams.id/);
  });

  it("keeps the profile's secret out of its output", async () => {
    setConfig({
      automationCallBaseUrl: "https://api.example.com",
      automationCredentials: { ops: { headers: { "x-api-key": "secret" } } },
    });
    const { sent, action: callRoute } = action(() =>
      Promise.resolve(new Response("{}", { status: 200 })),
    );
    const output = await callRoute.execute(
      { route: "POST /api/orders", credential: "ops", includeBody: true },
      CTX,
    );
    expect(JSON.stringify(output)).not.toContain("secret");
    expect(sent[0]?.headers.get("x-api-key")).toBe("secret");
    expect(output).toMatchObject({ ok: true, statusCode: 200, dryRun: false });
  });
});

describe("automationConfigErrors", () => {
  it("accepts profiles of headers and an http origin", () => {
    expect(
      automationConfigErrors({
        automationCallBaseUrl: "https://api.example.com",
        automationCredentials: { ops: { headers: { authorization: "x" } } },
      }),
    ).toEqual([]);
  });

  it("names a non-http origin and a malformed profile", () => {
    const errors = automationConfigErrors({
      automationCallBaseUrl: "ftp://api",
      automationCredentials: { ops: { headers: { "bad header": "x" } } },
    });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/^automationCallBaseUrl/);
    expect(errors[1]).toMatch(/^automationCredentials\.ops\.headers/);
  });
});
