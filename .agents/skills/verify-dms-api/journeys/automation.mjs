import { readFileSync } from "node:fs";
import { guarded } from "../guard.mjs";
import { FIXTURE_ROUTES, backendLog, check, isRow, isText, list, mon, num, pick, runAction, same, saveSettings, settled, text, traffic, withEnv } from "../api.mjs";
import { seedLogs, seedStatistics } from "../seed.mjs";

/** @typedef {import("../api.mjs").Ctx} Ctx */

/**
 * @param {unknown} value A JSON object
 * @returns {string[]} Its keys
 */
const keysOf = (value) => (isRow(value) ? Object.keys(value) : []);

const WITH_NODES = { VERIFY_API_AUTOMATION: "1" };

/**
 * @param {Ctx} ctx The journey
 * @param {string} id A trigger's id
 * @param {unknown} config Its configuration
 * @returns {Promise<string>} The activation's key
 */
async function arm(ctx, id, config) {
  const answer = await ctx.api(`arm ${id}`, { method: "POST", path: `/dms/verify-api/nodes/trigger/${id}/activate`, body: config, as: "anon" });
  return text(answer.body, "activation");
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} key An activation
 * @returns {Promise<{ flags: string[], rows: Record<string, unknown>[], ageMs: number }>} What it emitted so far
 */
async function emitted(ctx, key) {
  const answer = await ctx.api(`emissions of ${key}`, { method: "GET", path: `/dms/verify-api/nodes/trigger/activation/${key}`, as: "anon" });
  const rows = list(answer.body, "emissions");
  return { flags: rows.map((row) => `${text(row, "uri")}:${text(row, "flag")}`).toSorted((left, right) => left.localeCompare(right)), rows, ageMs: num(answer.body, "ageMs") ?? 0 };
}

export const journeys = guarded([
  {
    id: "without-the-automation-module-the-registration-is-a-silent-no-op",
    title: "with no @antelopejs/dms-automation in the project the module starts, says only that the optional interface has no provider, logs no error about the nodes, and the console keeps working",
    entryPoint: "the backend log of the start and GET /api/monitoring/overview/health",
    async run(/** @type {Ctx} */ ctx) {
      await ctx.restartBackend();
      await traffic(ctx, "a call", [{ path: "/fx/ok", count: 1 }]);
      const log = readFileSync(backendLog(ctx), "utf8").split("\n");
      const start = log.map((line) => /Server started/.test(line)).lastIndexOf(true);
      const lines = log.slice(Math.max(0, start - 60));
      const health = await mon(ctx, "health", "/overview/health");
      const settings = await mon(ctx, "settings", "/settings");
      await ctx.verify("the start", [
        check("the log says the optional automation interface has no provider", lines.some((line) => /Optional interface '@antelopejs\/interface-dms-automation' has no provider/.test(line)), lines.filter((line) => /automation/i.test(line))),
        same("no error line names the automation nodes", lines.filter((line) => /\[ERROR\]/.test(line) && /automation|api\.route-unhealthy|api\.get-api-health|api\.query-request-logs/i.test(line)), []),
        same("no line says dms-api failed", lines.filter((line) => /dms-api/.test(line) && /(failed|did not construct|Failed to)/i.test(line)), []),
        same("the console answers", [health.status, settings.status, num(settings.body, "statisticsLifetimeDays")], [200, 200, 90]),
        check("the health reads the call", text(health.body, "verdict") !== "", text(health.body, "verdict")),
      ]);
    },
  },
  {
    id: "the-module-registers-its-three-nodes-with-their-documented-inputs",
    title: "with an automation provider the module registers api.get-api-health, api.query-request-logs and the singleton trigger api.route-unhealthy, whose inputs declare days (minimum 1), limit (default 50, maximum 200), the three status classes, intervalSeconds (default 60, minimum 10) and the flags broken, slow and warn (default broken and slow)",
    entryPoint: "the nodes registered with the provider",
    async run(/** @type {Ctx} */ ctx) {
      await withEnv(ctx, WITH_NODES, async () => {
        const nodes = await ctx.api("the registered nodes", { method: "GET", path: "/dms/verify-api/nodes", as: "anon" });
        const actions = list(nodes.body, "actions").filter((node) => text(node, "id").startsWith("api."));
        const triggers = list(nodes.body, "triggers").filter((node) => text(node, "id").startsWith("api."));
        const property = (/** @type {unknown} */ node, /** @type {string} */ schema, /** @type {string} */ name) => pick(node, schema, "properties", name);
        const health = actions.find((node) => text(node, "id") === "api.get-api-health");
        const logs = actions.find((node) => text(node, "id") === "api.query-request-logs");
        const unhealthy = triggers.find((node) => text(node, "id") === "api.route-unhealthy");
        await ctx.verify("the nodes", [
          same("actions", actions.map((node) => text(node, "id")).toSorted((left, right) => left.localeCompare(right)), ["api.get-api-health", "api.query-request-logs"]),
          same("triggers", triggers.map((node) => text(node, "id")), ["api.route-unhealthy"]),
          same("the trigger runs on one node of a cluster", pick(unhealthy, "cluster"), "singleton"),
          same("days", [pick(property(health, "inputSchema", "days"), "type"), pick(property(health, "inputSchema", "days"), "minimum")], ["number", 1]),
          same("limit", [pick(property(logs, "inputSchema", "limit"), "default"), pick(property(logs, "inputSchema", "limit"), "maximum")], [50, 200]),
          same("statusClass", pick(property(logs, "inputSchema", "statusClass"), "enum"), ["success", "client-error", "server-error"]),
          same("the other filters", ["routeId", "uri", "method", "statusMin", "statusMax"].map((name) => pick(property(logs, "inputSchema", name), "type")), ["string", "string", "string", "number", "number"]),
          same("intervalSeconds", [pick(property(unhealthy, "configSchema", "intervalSeconds"), "default"), pick(property(unhealthy, "configSchema", "intervalSeconds"), "minimum")], [60, 10]),
          same("flags", [pick(property(unhealthy, "configSchema", "flags"), "items", "enum"), pick(property(unhealthy, "configSchema", "flags"), "default")], [["broken", "slow", "warn"], ["broken", "slow"]]),
          same("the trigger's output", keysOf(pick(unhealthy, "outputSchema", "properties")), ["routeKey", "method", "uri", "flag", "errorRate", "averageLatencyMs", "requestsLast24h"]),
          same("the health action's output", keysOf(pick(health, "outputSchema", "properties")), ["totalRoutes", "failingRoutes", "slowRoutesCount", "averageLatencyMs", "callsToday", "errors24h", "statusBreakdown"]),
        ]);
      });
    },
  },
  {
    id: "get-api-health-restricts-its-breakdown-to-the-last-days",
    title: "the status breakdown covers every retained day without days and the last N days with it (4 calls with 1 server error 10 days ago and 6 calls today), while the KPIs keep their fixed windows",
    entryPoint: "api.get-api-health.execute",
    async run(/** @type {Ctx} */ ctx) {
      await seedStatistics(ctx, "10 days ago", { method: "GET", uri: "/fx/ok", daysAgo: 10, requests: 4, serverErrors: 1 });
      await seedStatistics(ctx, "today", { method: "GET", uri: "/fx/ok", daysAgo: 0, requests: 6 });
      await withEnv(ctx, WITH_NODES, async () => {
        const breakdown = async (/** @type {unknown} */ input) => {
          const answer = await runAction(ctx, "api.get-api-health", input);
          return { all: pick(answer.body, "statusBreakdown"), kpis: answer.body };
        };
        const everything = await breakdown({});
        const one = await breakdown({ days: 1 });
        const five = await breakdown({ days: 5 });
        const thirty = await breakdown({ days: 30 });
        const figures = (/** @type {unknown} */ value) => [num(value, "total"), num(value, "serverErrors"), num(value, "clientErrors"), num(value, "success")];
        await ctx.verify("the breakdown", [
          same("without days: every retained day", figures(everything.all), [10, 1, 0, 9]),
          same("the last day", figures(one.all), [6, 0, 0, 6]),
          same("the last 5 days", figures(five.all), [6, 0, 0, 6]),
          same("the last 30 days", figures(thirty.all), [10, 1, 0, 9]),
        ]);
        await ctx.verify("the KPIs", [
          same("totalRoutes counts the routes of the scope", num(everything.kpis, "totalRoutes"), FIXTURE_ROUTES),
          same("the KPIs do not follow days", [num(one.kpis, "callsToday"), num(one.kpis, "totalRoutes")], [num(everything.kpis, "callsToday"), num(everything.kpis, "totalRoutes")]),
          same("callsToday", num(everything.kpis, "callsToday"), 6),
          same("no route is failing", [num(everything.kpis, "failingRoutes"), num(everything.kpis, "errors24h")], [0, 0]),
        ]);
      });
    },
  },
  {
    id: "query-request-logs-pages-caps-and-filters",
    title: "api.query-request-logs returns 50 rows by default, at most 200 whatever limit is asked, the rows of a status class, status range, uri or method, and a nextCursor while rows remain",
    entryPoint: "api.query-request-logs.execute",
    async run(/** @type {Ctx} */ ctx) {
      await seedLogs(ctx, "250 good calls", { minutesAgo: 100, count: 250, uri: "/fx/ok" });
      await seedLogs(ctx, "20 client errors", { minutesAgo: 50, count: 20, uri: "/fx/missing", statusCode: 404, message: "seeded gone" });
      await seedLogs(ctx, "3 server errors", { minutesAgo: 20, count: 3, uri: "/fx/boom", statusCode: 500, message: "seeded boom" });
      await withEnv(ctx, WITH_NODES, async () => {
        const ask = async (/** @type {unknown} */ input) => (await runAction(ctx, "api.query-request-logs", input)).body;
        const defaults = await ask({});
        const capped = await ask({ limit: 250 });
        const ten = await ask({ limit: 10 });
        const client = await ask({ statusClass: "client-error", limit: 200 });
        const server = await ask({ statusClass: "server-error" });
        const success = await ask({ statusClass: "success" });
        const range = await ask({ statusMin: 500, statusMax: 599 });
        const exact = await ask({ statusMin: 404, statusMax: 404, limit: 200 });
        const byUri = await ask({ uri: "/fx/missing", limit: 200 });
        const byMethod = await ask({ method: "POST" });
        const statuses = (/** @type {unknown} */ page) => [...new Set(list(page, "results").map((row) => num(row, "statusCode")))];
        await ctx.verify("the page size", [
          same("the default is 50 rows and more remain", [list(defaults, "results").length, text(defaults, "nextCursor") !== ""], [50, true]),
          same("a limit of 250 is capped to 200 and more remain", [list(capped, "results").length, text(capped, "nextCursor") !== ""], [200, true]),
          same("a limit of 10", [list(ten, "results").length, text(ten, "nextCursor") !== ""], [10, true]),
        ]);
        await ctx.verify("the filters", [
          same("client errors only", [list(client, "results").length, statuses(client), text(client, "nextCursor")], [20, [404], ""]),
          same("server errors only", [list(server, "results").length, statuses(server)], [3, [500]]),
          same("success only", [list(success, "results").length, statuses(success)], [50, [200]]),
          same("a status range", [list(range, "results").length, statuses(range)], [3, [500]]),
          same("a range of one status", [list(exact, "results").length, statuses(exact)], [20, [404]]),
          same("a uri", [list(byUri, "results").length, [...new Set(list(byUri, "results").map((row) => text(row, "uri")))]], [20, ["/fx/missing"]]),
          same("a method with none of it", list(byMethod, "results").length, 0),
          same("each row carries an ISO timestamp", isText(pick(list(defaults, "results")[0], "timestamp")) && !Number.isNaN(Date.parse(text(list(defaults, "results")[0], "timestamp"))), true),
        ]);
      });
    },
  },
  {
    id: "route-unhealthy-fires-on-the-flags-it-watches-and-never-faster-than-ten-seconds",
    title: "the trigger fires once for a route that enters broken or warn after it was armed, only for the flags it watches (default broken and slow), not for a state it saw when armed, and an interval under 10 seconds waits the 10",
    entryPoint: "api.route-unhealthy.activate",
    async run(/** @type {Ctx} */ ctx) {
      await saveSettings(ctx, "slow from 50 ms", { requestSlownessThresholdMs: 50 });
      await withEnv(ctx, WITH_NODES, async () => {
        const id = "api.route-unhealthy";
        const watching = {
          broken: await arm(ctx, id, { intervalSeconds: 10, flags: ["broken"] }),
          warn: await arm(ctx, id, { intervalSeconds: 10, flags: ["warn"] }),
          defaults: await arm(ctx, id, { intervalSeconds: 10 }),
          quick: await arm(ctx, id, { intervalSeconds: 1, flags: ["broken", "slow", "warn"] }),
        };
        await traffic(ctx, "a failing, a noisy and a slow route", [{ path: "/fx/boom", count: 25 }, { path: "/fx/missing", count: 25 }, { path: "/fx/slow?ms=80", count: 20 }]);
        await settled(ctx, "the routes are flagged", "/overview/attention", (body) => list(body, "items").length >= 3);
        const early = await emitted(ctx, watching.quick);
        await new Promise((resolve) => setTimeout(resolve, 12_000));
        const results = {
          broken: await emitted(ctx, watching.broken),
          warn: await emitted(ctx, watching.warn),
          defaults: await emitted(ctx, watching.defaults),
          quick: await emitted(ctx, watching.quick),
        };
        const boom = results.broken.rows[0];
        await ctx.verify("the flags", [
          same("broken only", results.broken.flags, ["/fx/boom:broken"]),
          same("warn only", results.warn.flags, ["/fx/missing:warn"]),
          same("the default flags are broken and slow", results.defaults.flags, ["/fx/boom:broken", "/fx/slow:slow"]),
          same("all three flags", results.quick.flags, ["/fx/boom:broken", "/fx/missing:warn", "/fx/slow:slow"]),
          same("the output of a broken route", [text(boom, "routeKey"), text(boom, "method"), text(boom, "uri"), text(boom, "flag"), num(boom, "requestsLast24h")], ["GET:/fx/boom", "GET", "/fx/boom", "broken", 25]),
          same("the error rate of a route failing every call, as a ratio", num(boom, "errorRate"), 1),
        ]);
        await ctx.verify("the interval", [
          same("an interval of 1 second fires nothing before 10 seconds", early.rows.length, 0),
          check("and fires after them", results.quick.rows.length === 3, results.quick.ageMs),
        ]);
        for (const key of Object.values(watching)) await ctx.api(`stop ${key}`, { method: "POST", path: `/dms/verify-api/nodes/trigger/${id}/deactivate/${key}`, as: "anon" });
      });
    },
  },
  {
    id: "query-request-logs-next-cursor-reads-the-next-page",
    title: "the nextCursor api.query-request-logs returns reads the next page: asked again with it, the action returns other rows (dms-api issue: the action takes no cursor input, so it returns the first page again)",
    entryPoint: "api.query-request-logs.execute",
    async run(/** @type {Ctx} */ ctx) {
      await seedLogs(ctx, "30 good calls", { minutesAgo: 100, count: 30, uri: "/fx/ok" });
      await withEnv(ctx, WITH_NODES, async () => {
        const ask = async (/** @type {unknown} */ input) => (await runAction(ctx, "api.query-request-logs", input)).body;
        const first = await ask({ limit: 10 });
        const second = await ask({ limit: 10, cursor: text(first, "nextCursor") });
        const ids = (/** @type {unknown} */ page) => list(page, "results").map((row) => text(row, "_id"));
        await ctx.verify("the next page", [
          check("a cursor comes back while rows remain", text(first, "nextCursor") !== "", text(first, "nextCursor")),
          check("asking with it returns other rows", ids(second).length === 10 && ids(second).every((id) => !ids(first).includes(id)), { first: ids(first), second: ids(second) }),
        ]);
      });
    },
  },
]);
