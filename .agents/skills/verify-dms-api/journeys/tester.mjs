import { guarded } from "../guard.mjs";
import { check, list, mon, num, pick, raw, same, settled, text, traffic, withConfig } from "../api.mjs";

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
  await tab.goto(`/modules/api/routes?route=${encodeURIComponent(ref)}&tab=tester`);
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
        check("the route's statistics hold no request", !JSON.stringify(summary.body).includes('"value":1'), summary.body),
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
]);
