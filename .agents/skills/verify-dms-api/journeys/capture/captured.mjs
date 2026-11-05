import { check, list, mon, num, pick, same, saveSettings, sendAndRead, settled, text, traffic } from "../../api.mjs";
import { JSON_HEADERS } from "./shared.mjs";

/** @typedef {import("../../api.mjs").Ctx} Ctx */

/** The capture journeys about captured. */
export const captured = [
  {
    id: "a-request-is-captured-with-its-facts",
    title: "a call to a project route is stored with its method, route pattern, raw path, path parameters, query, status, duration, client, request id, headers and bodies",
    entryPoint: "GET /api/monitoring/logs/:id after a call to /fx/*",
    async run(/** @type {Ctx} */ ctx) {
      const put = await sendAndRead(ctx, "PUT an item", { method: "PUT", path: "/fx/items/42?color=red&size=l", headers: JSON_HEADERS, body: JSON.stringify({ name: "chair" }) });
      const log = put.log;
      await ctx.verify("the stored request", [
        same("answered 200", put.status, 200),
        same("method", text(log, "method"), "PUT"),
        same("the route pattern", text(log, "uri"), "/fx/items/:id"),
        same("the raw path", text(log, "rawPath"), "/fx/items/42"),
        same("the path parameters", pick(log, "pathParams"), { id: "42" }),
        same("the query", pick(log, "query"), { color: "red", size: "l" }),
        same("the status", num(log, "statusCode"), 200),
        check("a duration was measured", (num(log, "responseTimeMs") ?? -1) >= 0, num(log, "responseTimeMs")),
        same("the client's user agent", text(log, "userAgent"), "verify-agent/1.0"),
        check("the client address is the loopback", /127\.0\.0\.1/.test(text(log, "ip")), text(log, "ip")),
        same("the request id comes from x-request-id", text(log, "requestId"), "req-capture-1"),
        same("the request body", text(log, "requestBody"), '{"name":"chair"}'),
        same("the response body", text(log, "responseBody"), '{"id":"42","body":{"name":"chair"}}'),
        same("the route is registered", pick(log, "routeRegistered"), true),
        same("the route reference", text(log, "route"), "PUT /fx/items/:id"),
      ]);
      const missing = await sendAndRead(ctx, "an unknown item", { path: "/fx/items/x9" });
      await ctx.verify("a client error", [same("status 404", num(missing.log, "statusCode"), 404), same("its message is the error shown", text(missing.log, "error", "message") || pick(missing.log, "error"), "no such item")]);
    },
  },
  {
    id: "a-thrown-error-keeps-its-message-and-its-stack",
    title: "a handler that throws is stored as a 500 with the error's message and stack, a thrown HTTP result with its message, and a clean call with no error",
    entryPoint: "GET /api/monitoring/logs/:id for /fx/boom, /fx/missing and /fx/ok",
    async run(/** @type {Ctx} */ ctx) {
      const boom = await sendAndRead(ctx, "boom", { path: "/fx/boom" });
      const missing = await sendAndRead(ctx, "missing", { path: "/fx/missing" });
      const ok = await sendAndRead(ctx, "ok", { path: "/fx/ok" });
      await ctx.verify("errors", [
        same("boom is a 500", num(boom.log, "statusCode"), 500),
        same("boom's message", text(boom.log, "error", "message"), "fixture boom: the invoice has no customer"),
        check("boom's stack names the handler", /fixture boom/.test(text(boom.log, "error", "stack")) && /boom/.test(text(boom.log, "error", "stack")), text(boom.log, "error", "stack").slice(0, 120)),
        same("missing is a 404", num(missing.log, "statusCode"), 404),
        same("missing's message is its body message", text(missing.log, "error", "message"), "fixture not found"),
        same("ok has no error", pick(ok.log, "error"), null),
      ]);
    },
  },
  {
    id: "the-consoles-own-and-the-dms-traffic-is-never-captured",
    title: "even under All routes, calls to /api/monitoring, /dms, the realtime channel and page layouts are neither logged nor counted",
    entryPoint: "GET /api/monitoring/logs under the All routes scope",
    async run(/** @type {Ctx} */ ctx) {
      await saveSettings(ctx, "watch all routes", { scope: "all" });
      await traffic(ctx, "one project call", [{ path: "/fx/ok", count: 1 }]);
      for (const path of ["/overview/health", "/logs", "/routes/list", "/settings/summary"]) await mon(ctx, `the console reads ${path}`, path);
      await ctx.api("a DMS call", { method: "GET", path: "/dms/pages/modules/api/overview/pagelayout" });
      await ctx.api("the onboarding probe", { method: "GET", path: "/api/onboarding/informations", as: "anon" });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const logs = await settled(ctx, "the logs", "/logs?limit=200", (body) => list(body, "results").some((row) => text(row, "path") === "/api/onboarding/informations"));
      const paths = list(logs.body, "results").map((row) => text(row, "path"));
      await ctx.verify("what is stored", [
        check("the project call is stored", paths.includes("/fx/ok"), paths),
        check("a module route (the onboarding probe) is stored under All routes", paths.includes("/api/onboarding/informations"), paths),
        same("no /api/monitoring call is stored", paths.filter((path) => path.startsWith("/api/monitoring")), []),
        same("no /dms call is stored", paths.filter((path) => path.startsWith("/dms")), []),
        same("no page layout is stored", paths.filter((path) => path.endsWith("/pagelayout")), []),
        same("no realtime call is stored", paths.filter((path) => path.startsWith("/api/realtime")), []),
      ]);
    },
  },
];
