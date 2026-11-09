import { guarded } from "../guard.mjs";
import { check, isText, member, mon, same, text, traffic } from "../api.mjs";

/** @typedef {import("../api.mjs").Ctx} Ctx */

/** Every route of the console: method and path under /api/monitoring. */
const ROUTES = [
  ["GET", "/overview/health"], ["GET", "/overview/traffic"], ["GET", "/overview/classes"], ["GET", "/overview/error-share"], ["GET", "/overview/attention"], ["GET", "/overview/slowest"], ["GET", "/overview/activity"],
  ["GET", "/logs"], ["GET", "/logs/recent"], ["GET", "/logs/routes?route=GET%20%2Ffx%2Fok"], ["GET", "/logs/tester?requestId=x"], ["GET", "/logs/live"],
  ["GET", "/logs/missing"], ["GET", "/logs/recent/missing"], ["GET", "/logs/tester/missing"], ["GET", "/logs/routes/missing"],
  ["GET", "/routes/list"], ["GET", "/routes/detail?route=GET%20%2Ffx%2Fok"], ["GET", "/routes/statistics/activity?route=GET%20%2Ffx%2Fok"], ["GET", "/routes/statistics/summary?route=GET%20%2Ffx%2Fok"],
  ["GET", "/routes/statistics/status?route=GET%20%2Ffx%2Fok"], ["GET", "/routes/statistics/latency-chart?route=GET%20%2Ffx%2Fok"], ["GET", "/routes/statistics/errors?route=GET%20%2Ffx%2Fok"],
  ["GET", "/settings"], ["POST", "/settings"], ["GET", "/settings/retention-impact?field=requestLogRetentionDays&days=30"], ["GET", "/settings/summary"], ["GET", "/tester/source"],
];

/** The permission each route of the console names in a refusal: one block, one id. */
const BLOCK_OF = new Map([
  ["GET /overview/health", "modules.api.monitor.overview.health"],
  ["GET /overview/traffic", "modules.api.monitor.overview.dashboard.traffic.chart"],
  ["GET /overview/classes", "modules.api.monitor.overview.dashboard.traffic.classes"],
  ["GET /overview/error-share", "modules.api.monitor.overview.dashboard.health.errorShare"],
  ["GET /overview/attention", "modules.api.monitor.overview.dashboard.health.attention"],
  ["GET /overview/slowest", "modules.api.monitor.overview.dashboard.health.slowest"],
  ["GET /overview/activity", "modules.api.monitor.overview.dashboard.recent.activity"],
  ["GET /logs", "modules.api.monitor.logs.requests"],
  ["GET /logs/recent", "modules.api.monitor.overview.dashboard.recent.requests.table"],
  ["GET /logs/routes", "modules.api.explore.routes.explorer.tabs.statistics.recent.requests.table"],
  ["GET /logs/tester", "modules.api.explore.routes.explorer.tabs.tester"],
  ["GET /logs/live", "modules.api.monitor.logs.live"],
  ["GET /logs/missing", "modules.api.monitor.logs.requests"],
  ["GET /logs/recent/missing", "modules.api.monitor.overview.dashboard.recent.requests.table"],
  ["GET /logs/tester/missing", "modules.api.explore.routes.explorer.tabs.tester"],
  ["GET /logs/routes/missing", "modules.api.explore.routes.explorer.tabs.statistics.recent.requests.table"],
  ["GET /routes/list", "modules.api.explore.routes.explorer.tree"],
  ["GET /routes/detail", "modules.api.explore.routes.explorer"],
  ["GET /routes/statistics/activity", "modules.api.explore.routes.explorer.tabs.statistics"],
  ["GET /routes/statistics/summary", "modules.api.explore.routes.explorer.tabs.statistics.grid.summary.summary"],
  ["GET /routes/statistics/status", "modules.api.explore.routes.explorer.tabs.statistics.grid.charts.status"],
  ["GET /routes/statistics/latency-chart", "modules.api.explore.routes.explorer.tabs.statistics.grid.charts.latency"],
  ["GET /routes/statistics/errors", "modules.api.explore.routes.explorer.tabs.statistics.grid.detail.errors"],
  ["GET /settings", "modules.api.configure.settings.form"],
  ["POST /settings", "modules.api.configure.settings.form"],
  ["GET /settings/retention-impact", "modules.api.configure.settings.form"],
  ["GET /tester/source", "modules.api.explore.routes.explorer.tabs.tester"],
]);

/**
 * @param {Ctx} ctx The journey
 * @param {string} as The account
 * @returns {Promise<{ route: string, status: number | null, message: string }[]>} What each route answered
 */
async function sweep(ctx, as) {
  const seen = [];
  for (const [method, path] of ROUTES) {
    const answer = await mon(ctx, `${method} ${path} as ${as}`, path, { method, as, body: method === "POST" ? {} : undefined });
    const body = answer.body;
    seen.push({ route: `${method} ${path.split("?")[0]}`, status: answer.status, message: isText(body) ? body : text(body, "message") || text(body, "error") });
  }
  return seen;
}

export const journeys = guarded([
  {
    id: "every-console-route-needs-a-session-and-the-block-it-serves",
    title: "every route of the console answers 401 without a session and 403 naming the missing permission to a member whose role holds none, while the owner passes every one",
    entryPoint: "every /api/monitoring route",
    async run(/** @type {Ctx} */ ctx) {
      await traffic(ctx, "a request to read", [{ path: "/fx/ok", count: 1 }]);
      await member(ctx, "plain", []);
      const anonymous = await sweep(ctx, "anon");
      const plain = await sweep(ctx, "plain");
      const owner = await sweep(ctx, "admin");
      await ctx.verify("without a session", anonymous.map((entry) => same(`${entry.route} is 401`, entry.status, 401)));
      await ctx.verify("a member with no permission", plain.map((entry) => same(`${entry.route} refuses with its own block's permission`, entry.message, entry.route === "GET /settings/summary" ? "Owner-only" : `Forbidden: missing permission ${BLOCK_OF.get(entry.route)}`)));
      await ctx.verify("the owner", owner.map((entry) => check(`${entry.route} passes the guard`, entry.status !== 401 && entry.status !== 403, entry)));
    },
  },
  {
    id: "the-console-is-the-owners-and-a-role-holding-a-block-is-refused",
    title: "a role holding the Request logs table's permission, or the Tester's, is still refused on every route of the console, while the owner opens both",
    entryPoint: "GET /api/monitoring/logs and /api/monitoring/tester/source as members",
    async run(/** @type {Ctx} */ ctx) {
      await traffic(ctx, "a request to read", [{ path: "/fx/ok", count: 1 }]);
      await member(ctx, "plain", []);
      const refused = await sweep(ctx, "plain");
      const needed = (/** @type {string} */ route) => /missing permission ([\w.-]+)/.exec(refused.find((entry) => entry.route === route)?.message ?? "")?.[1] ?? "";
      const logsPermission = needed("GET /logs");
      const testerPermission = needed("GET /tester/source");
      await ctx.verify("the permissions the refusals name", [check("the logs table has its own permission", logsPermission.startsWith("modules.api."), logsPermission), check("the Tester has its own permission", testerPermission.startsWith("modules.api.") && testerPermission !== logsPermission, testerPermission)]);
      await member(ctx, "reader", [logsPermission]);
      await member(ctx, "tester", [testerPermission]);
      const reader = await sweep(ctx, "reader");
      const tester = await sweep(ctx, "tester");
      const owner = await sweep(ctx, "admin");
      await ctx.verify("the reader", reader.map((entry) => check(`${entry.route} is refused`, entry.status === 403, entry)));
      await ctx.verify("the tester", tester.map((entry) => check(`${entry.route} is refused`, entry.status === 403, entry)));
      await ctx.verify("the owner", ["GET /logs", "GET /tester/source"].map((route) => check(`${route} opens`, owner.find((entry) => entry.route === route)?.status === 200, owner.find((entry) => entry.route === route))));
    },
  },
]);
