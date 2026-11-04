import { guarded } from "../guard.mjs";
import { check, list, mon, num, pick, raw, same, settled, text, traffic, withConfig, openPage } from "../api.mjs";

/** @typedef {import("../api.mjs").Ctx} Ctx */

const TESTER_HEADER = "x-antelopejs-api-source";

/**
 * Opens the Tester of a route in a signed-in tab.
 *
 * @param {Ctx} ctx The journey
 * @param {string} ref The route reference
 * @returns {Promise<import("../api.mjs").Tab>} The tab
 */
async function tester(ctx, ref) {
  const tab = await ctx.tab("admin");
  await tab.signIn("admin");
  await openPage(tab, `/modules/api/routes?route=${encodeURIComponent(ref)}&tab=tester`);
  await tab.visible({ role: "button", name: "Send" });
  return tab;
}

export const journeys = guarded([
  {
    id: "a-tester-call-is-logged-and-marked-but-never-counted",
    title: "Send calls the route through the frontend server; the call is stored marked as the Tester's, found by its x-request-id, and left out of the route's statistics, the health and the Overview",
    entryPoint: "/modules/api/routes?route=GET /fx/boom&tab=tester",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await tester(ctx, "GET /fx/boom");
      await tab.click({ role: "button", name: "Send" });
      await ctx.verify("the response", [tab.shows(/500/), tab.shows(/fixture boom: the invoice has no customer/i)]);
      const logs = await settled(ctx, "the logs", "/logs?limit=20&filter_path=is:/fx/boom", (body) => list(body, "results").length === 1);
      const row = list(logs.body, "results")[0];
      const listed = await mon(ctx, "the Tester's own read by request id", `/logs/tester?requestId=${encodeURIComponent(text(row, "requestId"))}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const summary = await mon(ctx, "the route's statistics", "/routes/statistics/summary?route=GET%20%2Ffx%2Fboom&preset=last-24h");
      const health = await mon(ctx, "the health", "/overview/health");
      const attention = await mon(ctx, "attention", "/overview/attention");
      const detail = await mon(ctx, "the route", "/routes/detail?route=GET%20%2Ffx%2Fboom");
      await ctx.verify("what was stored", [
        same("the call is marked as the Tester's", text(row, "source"), "tester"),
        check("it carries an x-request-id", text(row, "requestId") !== "", text(row, "requestId")),
        same("the Tester's read finds it", list(listed.body, "results").map((entry) => text(entry, "path")), ["/fx/boom"]),
      ]);
      await ctx.verify("what was left out", [
        same("the route's statistics list no card: no request counted", list(summary.body, "items").length, 0),
        same("the health counted nothing", num(health.body, "metrics", "requests"), 0),
        same("nothing needs attention", pick(attention.body, "count"), 0),
        same("the route stays idle", text(detail.body, "state"), "idle"),
      ]);
    },
  },
  {
    id: "a-secret-keeps-the-testers-token-valid-across-restarts",
    title: "with testerSourceSecret set the Tester's token survives a restart and still marks the call; without it a token issued before the restart is no longer recognised, and its call counts as traffic",
    entryPoint: "GET /api/monitoring/tester/source then a call with the header",
    async run(/** @type {Ctx} */ ctx) {
      const tokenAnswer = await mon(ctx, "ask a token", "/tester/source");
      const expiresAt = Date.parse(text(tokenAnswer.body, "expiresAt"));
      await ctx.verify("the token", [
        same("the header name", text(tokenAnswer.body, "header"), TESTER_HEADER),
        check("valid 15 minutes", Math.abs(expiresAt - Date.now() - 15 * 60_000) < 60_000, text(tokenAnswer.body, "expiresAt")),
        check("a value is given", text(tokenAnswer.body, "value").length > 10, "value"),
      ]);
      /** @type {string} */
      let signedWithSecret = "";
      await withConfig(ctx, { testerSourceSecret: "one-secret-for-every-instance" }, async () => {
        signedWithSecret = text((await mon(ctx, "a token under the secret", "/tester/source")).body, "value");
      });
      await withConfig(ctx, { testerSourceSecret: "one-secret-for-every-instance" }, async () => {
        await raw(ctx, "a call with the token of before the restart", { path: "/fx/ok", headers: { [TESTER_HEADER]: signedWithSecret } });
        const marked = await settled(ctx, "the logs", "/logs?limit=5", (body) => list(body, "results").length === 1);
        await ctx.verify("under the same secret", [same("the call is the Tester's", text(list(marked.body, "results")[0], "source"), "tester")]);
      });
      await raw(ctx, "a call with a token signed under the secret, secret now unset", { path: "/fx/ok", headers: { [TESTER_HEADER]: signedWithSecret } });
      const logs = await settled(ctx, "the logs", "/logs?limit=5", (body) => list(body, "results").length === 2);
      const newest = list(logs.body, "results")[0];
      await ctx.verify("without the secret", [same("the call is no longer the Tester's", pick(newest, "source"), null)]);
      await traffic(ctx, "a plain call", [{ path: "/fx/ok", count: 1 }]);
    },
  },
  {
    id: "the-tester-sends-the-form-and-keeps-twenty-five-calls",
    title: "Send calls the route without credentials until Send with my session is on, a header added in the form reaches the handler, Ctrl Enter sends too, and the History keeps the last 25 calls with their credential note",
    entryPoint: "/modules/api/routes?route=GET /fx/whoami&tab=tester",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await tester(ctx, "GET /fx/whoami");
      await tab.click({ role: "button", name: "Send" });
      await ctx.verify("no credentials", [
        tab.shows(/"authorization": "absent"/),
        tab.shows(/Send with my session\s+No credentials are sent/),
        tab.visible({ role: "button", name: /^GET 200 \/fx\/whoami no credentials / }),
      ]);
      await tab.click({ role: "button", name: "Add header", nth: 0 });
      await tab.fill({ role: "textbox", name: "Name", nth: 0 }, "x-extra");
      await tab.fill({ role: "textbox", name: "Value", nth: 0 }, "from-the-form");
      await tab.click({ role: "button", name: "Send" });
      await ctx.verify("a header from the form", [tab.shows(/"extra": "from-the-form"/), tab.shows(/"authorization": "absent"/)]);
      await tab.click({ role: "switch", name: "Send with my session" });
      await tab.click({ role: "button", name: "Send" });
      await ctx.verify("with my session", [tab.shows(/"authorization": "present"/), tab.shows(/Send with my session\s+Your session token is sent/)]);
      await tab.press("Control+Enter", { role: "textbox", name: "Value", nth: 0 });
      await ctx.verify("Ctrl Enter sends", [tab.count({ role: "button", name: /^GET 200 \/fx\/whoami/ }, 4)]);
      for (let index = 0; index < 24; index += 1) {
        await tab.press("Control+Enter", { role: "textbox", name: "Value", nth: 0 });
        await tab.page.waitForTimeout(250);
      }
      await ctx.verify("the History", [tab.count({ role: "button", name: /^GET 200 \/fx\/whoami/ }, 25)]);
      const logs = await settled(ctx, "the Tester's calls are stored", "/logs?limit=100", (body) => list(body, "results").filter((row) => text(row, "source") === "tester").length === 28);
      await ctx.verify("the logs", [same("every Send is one stored Tester call", list(logs.body, "results").filter((row) => text(row, "source") === "tester").length, 28)]);
    },
  },
]);
