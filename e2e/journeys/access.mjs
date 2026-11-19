import { guarded } from "../guard.mjs";
import { check, isText, list, member, mon, raw, same, saveSettings, settled, text, traffic, openPage } from "../api.mjs";

/** @typedef {import("../api.mjs").Ctx} Ctx */
/** @typedef {import("../api.mjs").Row} Row */

const TESTER_HEADER = "x-antelopejs-api-source";

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
    tag: "@smoke",
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
  {
    id: "a-member-without-the-modules-permissions-is-sent-to-their-settings",
    title: "every page of the console sends a member whose role holds none of its permissions to their own Settings page, where none of the console's headings show, while the owner stays on the page",
    entryPoint: "/modules/api, /modules/api/overview, /modules/api/logs, /modules/api/routes and /modules/api/settings",
    async run(/** @type {Ctx} */ ctx) {
      await member(ctx, "plain", []);
      const owner = await ctx.tab("admin", "owner");
      await owner.signIn("admin");
      const tab = await ctx.tab("plain");
      await tab.signIn("plain");
      const pages = [["overview", "Overview"], ["logs", "Request logs"], ["routes", "Routes"], ["settings", "API settings"]];
      for (const [page, heading] of pages) {
        await openPage(owner, `/modules/api/${page}`);
        await ctx.verify(`the owner on ${page}`, [owner.at(new RegExp(`^/modules/api/${page}$`)), owner.visible({ role: "heading", name: heading, level: 1, exact: true })]);
        await openPage(tab, `/modules/api/${page}`);
        await ctx.verify(`the member on ${page}`, [
          tab.at(/^\/settings$/),
          tab.visible({ role: "heading", name: "Settings", level: 1, exact: true }),
          tab.visible({ role: "heading", name: heading, level: 1, exact: true }, { hidden: true, timeoutMs: 2000 }),
        ]);
      }
      await openPage(tab, "/modules/api");
      await ctx.verify("the member on the module's own path", [tab.at(/^\/settings$/), tab.visible({ role: "heading", name: "Settings", level: 1, exact: true })]);
    },
  },
  {
    id: "a-panel-opened-from-one-table-reads-only-a-request-that-table-can-list",
    title: "with the scope narrowed to the project's routes, the Request logs panel still reads a module's request, while the Overview's and the Routes page's panels answer 404 for it, the Tester's panel reads it only when the Tester sent it, and every panel reads the project's own request",
    entryPoint: "GET /api/monitoring/logs/:id, /logs/recent/:id, /logs/routes/:id and /logs/tester/:id",
    async run(/** @type {Ctx} */ ctx) {
      await saveSettings(ctx, "watch every route", { scope: "all" });
      await traffic(ctx, "a project request", [{ path: "/fx/ok", count: 1 }]);
      await ctx.api("a module request", { method: "GET", path: "/api/onboarding/informations", as: "anon" });
      const token = text((await mon(ctx, "ask a token", "/tester/source")).body, "value");
      await raw(ctx, "a module request the Tester sent", { path: "/api/onboarding/informations?from=tester", headers: { [TESTER_HEADER]: token } });
      const logs = await settled(ctx, "the three requests are logged", "/logs?limit=50", (body) => list(body, "results").length === 3);
      const rows = list(logs.body, "results");
      const idOf = (/** @type {(row: Row) => boolean} */ match) => text(rows.find(match), "_id");
      const projectId = idOf((row) => text(row, "path") === "/fx/ok");
      const moduleId = idOf((row) => text(row, "path") === "/api/onboarding/informations" && text(row, "source") !== "tester");
      const sentId = idOf((row) => text(row, "source") === "tester");
      await ctx.verify("the three requests", [check("each has an id", [projectId, moduleId, sentId].every((id) => id !== ""), { projectId, moduleId, sentId })]);
      await saveSettings(ctx, "watch the project's routes only", { scope: "own" });
      /** @type {Record<string, Record<string, number | null>>} */
      const answers = {};
      for (const table of ["logs", "recent", "routes", "tester"]) {
        answers[table] = {};
        for (const [name, id] of [["project", projectId], ["module", moduleId], ["sent", sentId]]) {
          answers[table][name] = (await mon(ctx, `${table} panel reads the ${name} request`, `/logs/${table === "logs" ? "" : `${table}/`}${id}`)).status;
        }
      }
      const unknown = await mon(ctx, "the Overview's panel reads an id nothing holds", "/logs/recent/0123456789abcdef01234567");
      const refused = await mon(ctx, "the Overview's panel reads the module's request", `/logs/recent/${moduleId}`);
      await ctx.verify("the project's own request", Object.entries(answers).map(([table, got]) => same(`the ${table} panel reads it`, got.project, 200)));
      await ctx.verify("a module's request", [
        same("the Request logs panel reads it: that table lists every request", answers.logs?.module, 200),
        same("the Overview's panel does not", answers.recent?.module, 404),
        same("the Routes page's panel does not", answers.routes?.module, 404),
        same("the Tester's panel does not", answers.tester?.module, 404),
      ]);
      await ctx.verify("a module's request the Tester sent", [
        same("the Request logs panel reads it", answers.logs?.sent, 200),
        same("the Overview's panel does not", answers.recent?.sent, 404),
        same("the Routes page's panel does not", answers.routes?.sent, 404),
        same("the Tester's panel reads it: it reads back its own calls to any route", answers.tester?.sent, 200),
      ]);
      await ctx.verify("a request out of reach is not told apart from a missing one", [same("the refusal and the missing id answer alike", [refused.status, refused.body], [unknown.status, unknown.body])]);
    },
  },
]);
