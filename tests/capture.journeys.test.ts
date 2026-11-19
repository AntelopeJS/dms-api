import { describe, expect } from "vitest";
import { z } from "zod";
import { test } from "./helpers/dms";
import { resultsOf } from "./helpers/json";

const JSON_HEADERS = {
  "content-type": "application/json",
  "user-agent": "verify-agent/1.0",
  "x-request-id": "req-capture-1",
  "x-webhook-signature": "sig-1",
  authorization: "Bearer top-secret",
  cookie: "sid=1",
  "proxy-authorization": "Basic cHJveHk6cHc=",
  "set-cookie": "sid=2",
  "x-api-key": "k-1",
  origin: "https://client.example.org",
  referer: "https://client.example.org/page",
};

const pathSchema = z.object({ path: z.string() });

describe("capture", () => {
  test("a-request-is-captured-with-its-facts", async ({ dms }) => {
    const put = await dms.sendAndRead({
      method: "PUT",
      path: "/fx/items/42?color=red&size=l",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "chair" }),
    });
    expect.soft(put.status, "answered 200").toBe(200);
    expect.soft(put.log, "the stored request").toMatchObject({
      method: "PUT",
      uri: "/fx/items/:id",
      rawPath: "/fx/items/42",
      pathParams: { id: "42" },
      query: { color: "red", size: "l" },
      statusCode: 200,
      userAgent: "verify-agent/1.0",
      requestId: "req-capture-1",
      requestBody: '{"name":"chair"}',
      responseBody: '{"id":"42","body":{"name":"chair"}}',
      routeRegistered: true,
      route: "PUT /fx/items/:id",
    });
    const measured = z
      .object({ responseTimeMs: z.number(), ip: z.string() })
      .parse(put.log);
    expect
      .soft(measured.responseTimeMs, "a duration was measured")
      .toBeGreaterThanOrEqual(0);
    expect
      .soft(measured.ip, "the client address is the loopback")
      .toMatch(/127\.0\.0\.1/);
    const missing = await dms.sendAndRead({ path: "/fx/items/x9" });
    expect
      .soft(missing.log, "a client error keeps its message")
      .toMatchObject({ statusCode: 404, error: { message: "no such item" } });
  });

  test("a-thrown-error-keeps-its-message-and-its-stack", async ({ dms }) => {
    const boom = await dms.sendAndRead({ path: "/fx/boom" });
    const missing = await dms.sendAndRead({ path: "/fx/missing" });
    const ok = await dms.sendAndRead({ path: "/fx/ok" });
    expect
      .soft(boom.log, "a thrown error is a 500 with its message")
      .toMatchObject({
        statusCode: 500,
        error: { message: "fixture boom: the invoice has no customer" },
      });
    const stack = z
      .object({ error: z.object({ stack: z.string() }) })
      .parse(boom.log).error.stack;
    expect
      .soft(stack, "its stack names the handler")
      .toMatch(/fixture boom[\s\S]*boom/);
    expect
      .soft(missing.log, "a thrown HTTP result keeps its body message")
      .toMatchObject({
        statusCode: 404,
        error: { message: "fixture not found" },
      });
    expect
      .soft(ok.log, "a clean call has no error")
      .toMatchObject({ error: null });
  });

  test("the-consoles-own-and-the-dms-traffic-is-never-captured", async ({
    dms,
  }) => {
    await dms.saveSettings({ scope: "all" });
    await dms.traffic([{ path: "/fx/ok", count: 1 }]);
    for (const path of [
      "/overview/health",
      "/logs",
      "/routes/list",
      "/settings/summary",
    ])
      await dms.mon(path);
    await dms.api("GET", "/dms/pages/modules/api/overview/pagelayout");
    await dms.api("GET", "/api/onboarding/informations", { as: "anon" });
    await new Promise((done) => setTimeout(done, 1500));
    const logs = await dms.settled("/logs?limit=200", (body) =>
      resultsOf(body, pathSchema).some(
        (row) => row.path === "/api/onboarding/informations",
      ),
    );
    const paths = resultsOf(logs.body, pathSchema).map((row) => row.path);
    expect.soft(paths, "the project call is stored").toContain("/fx/ok");
    expect
      .soft(
        paths,
        "a module route (the onboarding probe) is stored under All routes",
      )
      .toContain("/api/onboarding/informations");
    expect
      .soft(
        paths.filter((path) => path.startsWith("/api/monitoring")),
        "no /api/monitoring call is stored",
      )
      .toEqual([]);
    expect
      .soft(
        paths.filter((path) => path.startsWith("/dms")),
        "no /dms call is stored",
      )
      .toEqual([]);
    expect
      .soft(
        paths.filter((path) => path.endsWith("/pagelayout")),
        "no page layout is stored",
      )
      .toEqual([]);
    expect
      .soft(
        paths.filter((path) => path.startsWith("/api/realtime")),
        "no realtime call is stored",
      )
      .toEqual([]);
  });
});
