import { guarded } from "../guard.mjs";
import { check, list, member, mon, raw, same, saveSettings, settled, text, traffic, openPage } from "../api.mjs";

/** @typedef {import("../api.mjs").Ctx} Ctx */
/** @typedef {import("../api.mjs").Row} Row */

const TESTER_HEADER = "x-antelopejs-api-source";

export const journeys = guarded([
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
