import { guarded } from "../guard.mjs";
import { check, member, mon, same, text, traffic } from "../api.mjs";

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
    seen.push({ route: `${method} ${path.split("?")[0]}`, status: answer.status, message: typeof body === "string" ? body : text(body, "message") || text(body, "error") });
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
      await ctx.verify("a member with no permission", plain.map((entry) => check(`${entry.route} is 403 and names what is missing`, entry.status === 403 && /(missing permission|Owner-only)/.test(entry.message), entry)));
      await ctx.verify("the owner", owner.map((entry) => check(`${entry.route} passes the guard`, entry.status !== 401 && entry.status !== 403, entry)));
    },
  },
  {
    id: "a-role-opens-the-blocks-it-holds-and-no-others",
    title: "a role holding only the Request logs table opens the logs and nothing else; a role holding only the Tester opens the Tester's token and nothing else",
    entryPoint: "GET /api/monitoring/logs and /api/monitoring/tester/source as members",
    async run(/** @type {Ctx} */ ctx) {
      await traffic(ctx, "a request to read", [{ path: "/fx/ok", count: 1 }]);
      await member(ctx, "plain", []);
      const refused = await sweep(ctx, "plain");
      const needed = (/** @type {string} */ route) => /missing permission ([\w.-]+)/.exec(refused.find((entry) => entry.route === route)?.message ?? "")?.[1] ?? "";
      const logsPermission = needed("GET /logs");
      const testerPermission = needed("GET /tester/source");
      await ctx.verify("the permissions the refusals name", [check("the logs table has its own permission", /^modules\.api\./.test(logsPermission), logsPermission), check("the Tester has its own permission", /^modules\.api\./.test(testerPermission) && testerPermission !== logsPermission, testerPermission)]);
      await member(ctx, "reader", [logsPermission]);
      await member(ctx, "tester", [testerPermission]);
      const reader = await sweep(ctx, "reader");
      const tester = await sweep(ctx, "tester");
      await ctx.verify("the reader", reader.map((entry) => (entry.route === "GET /logs" ? check("GET /logs opens", entry.status === 200, entry) : check(`${entry.route} stays closed`, entry.status === 403, entry))));
      await ctx.verify("the tester", tester.map((entry) => (entry.route === "GET /tester/source" ? check("the Tester's token opens", entry.status === 200, entry) : check(`${entry.route} stays closed`, entry.status === 403, entry))));
    },
  },
]);
