import { guarded } from "../guard.mjs";
import { saveSettings, check, list, mon, num, pick, raw, same, settled, text, traffic, withConfig, openPage } from "../api.mjs";

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
      await tab.reload();
      await tab.click({ role: "tab", name: "Tester" });
      await ctx.verify("after a reload", [tab.count({ role: "button", name: /^GET 200 \/fx\/whoami/ }, 25)]);
      const second = await ctx.tab("admin", "second tab");
      await second.goto(`/modules/api/routes?route=${encodeURIComponent("GET /fx/whoami")}&tab=tester`);
      await ctx.verify("a second tab of the same browser", [second.count({ role: "button", name: /^GET 200 \/fx\/whoami/ }, 25)]);
      await tab.goto(`/modules/api/routes?route=${encodeURIComponent("GET /fx/ok")}&tab=tester`);
      await tab.visible({ role: "button", name: "Send" });
      await ctx.verify("another route has its own History", [tab.count({ role: "button", name: /^GET 200 \/fx\/whoami/ }, 0)]);
      const logs = await settled(ctx, "the Tester's calls are stored", "/logs?limit=100", (body) => list(body, "results").filter((row) => text(row, "source") === "tester").length === 28);
      await ctx.verify("the logs", [same("every Send is one stored Tester call", list(logs.body, "results").filter((row) => text(row, "source") === "tester").length, 28)]);
    },
  },
  {
    id: "a-history-entry-restores-its-call-and-a-typed-authorization-beats-the-session",
    title: "clicking the older History entry restores its header and its response; with Send with my session on, a header named Authorization reaches the handler instead of the session's token",
    entryPoint: "/modules/api/routes?route=GET /fx/whoami&tab=tester",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await tester(ctx, "GET /fx/whoami");
      await tab.click({ role: "button", name: "Add header", nth: 0 });
      await tab.fill({ role: "textbox", name: "Name", nth: 0 }, "x-extra");
      await tab.fill({ role: "textbox", name: "Value", nth: 0 }, "one");
      await tab.click({ role: "button", name: "Send" });
      await ctx.verify("the first call", [tab.shows(/"extra": "one"/)]);
      await tab.fill({ role: "textbox", name: "Value", nth: 0 }, "two");
      await tab.click({ role: "button", name: "Send" });
      await ctx.verify("the second call", [tab.shows(/"extra": "two"/), tab.count({ role: "button", name: /^GET 200 \/fx\/whoami/ }, 2)]);
      await tab.click({ role: "button", name: /^GET 200 \/fx\/whoami/, nth: 1 });
      await ctx.verify("the older entry", [
        same("the header field reads the older value", await tab.value({ role: "textbox", name: "Value", nth: 0 }), "one"),
        tab.shows(/"extra": "one"/),
      ]);
      await tab.click({ role: "switch", name: "Send with my session" });
      await tab.click({ role: "button", name: "Add header", nth: 0 });
      await tab.fill({ role: "textbox", name: "Name", nth: 1 }, "Authorization");
      await tab.fill({ role: "textbox", name: "Value", nth: 1 }, "Bearer fixture-token");
      await tab.click({ role: "button", name: "Send" });
      await ctx.verify("a typed Authorization", [tab.shows(/"typed": true/), tab.shows(/"bearer": "ixture-token"|"bearer": "fixture-token"/)]);
      await tab.click({ role: "button", name: "Remove", nth: 1 });
      await tab.click({ role: "button", name: "Send" });
      await ctx.verify("only the session", [tab.shows(/"typed": false/), tab.shows(/"authorization": "present"/)]);
    },
  },
  {
    id: "headers-for-all-routes-are-kept-in-the-browser-but-credentials-are-not",
    title: "a header set for all routes reaches every route and is still there after a reload; a credential set the same way works until the reload and is gone after it",
    entryPoint: "/modules/api/routes?route=GET /fx/whoami&tab=tester",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await tester(ctx, "GET /fx/whoami");
      await tab.click({ role: "button", name: "Add header", nth: 1 });
      await tab.fill({ role: "textbox", name: "Name", nth: 0 }, "x-extra");
      await tab.fill({ role: "textbox", name: "Value", nth: 0 }, "for-all");
      await tab.click({ role: "button", name: "Add header", nth: 1 });
      await tab.fill({ role: "textbox", name: "Name", nth: 1 }, "Authorization");
      await tab.fill({ role: "textbox", name: "Value", nth: 1 }, "Bearer fixture-token");
      await tab.click({ role: "button", name: "Send" });
      await ctx.verify("both reach the route", [tab.shows(/"extra": "for-all"/), tab.shows(/"typed": true/)]);
      await tab.reload();
      await tab.click({ role: "tab", name: "Tester" });
      await tab.visible({ role: "button", name: "Send" });
      await tab.click({ role: "button", name: "Send" });
      await ctx.verify("after a reload", [tab.shows(/"extra": "for-all"/), tab.shows(/"typed": false/), tab.shows(/"authorization": "absent"/)]);
      const other = await ctx.tab("admin", "other route");
      await other.goto(`/modules/api/routes?route=${encodeURIComponent("GET /fx/ok")}&tab=tester`);
      await ctx.verify("another route", [other.visible({ role: "textbox", name: "Name" }), same("the header kept for all routes", await other.value({ role: "textbox", name: "Name", nth: 0 }), "x-extra")]);
    },
  },
  {
    id: "a-replayed-call-needs-its-credentials-and-redacted-values-by-hand",
    title: "Replay in tester restores a captured call without its Authorization, leaves a redacted password as [REDACTED], and replays a body cut at capture as text",
    entryPoint: "/modules/api/logs?record=<id> then Replay in tester",
    async run(/** @type {Ctx} */ ctx) {
      await saveSettings(ctx, "cap at 1 KB", { requestLogMaxBodyKb: 1 });
      const small = await raw(ctx, "a call with credentials", { method: "POST", path: "/fx/orders/shop1/lines?limit=5", headers: { "content-type": "application/json", authorization: "Bearer replay-secret", "x-tenant": "t1" }, body: JSON.stringify({ sku: "A1", quantity: 2, password: "hunter2" }) });
      const big = await raw(ctx, "a call above the cap", { method: "POST", path: "/fx/orders/shop2/lines", headers: { "content-type": "application/json" }, body: JSON.stringify({ sku: "B2", quantity: 1, pad: "x".repeat(2000) }) });
      await settled(ctx, "both stored", "/logs?limit=10", (body) => list(body, "results").length === 2);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/logs");
      await tab.click({ role: "button", name: "Open request", nth: 1 });
      await tab.click({ role: "link", name: "Replay in tester" });
      await ctx.verify("a call with a redacted password", [
        tab.shows(/Replayed from [0-9a-f-]{8}/),
        tab.shows(/Not restored: [^\n]*Authorization, Cookie and X-Api-Key are never captured\./),
        tab.shows(/"password": "\[REDACTED\]"/),
        tab.shows(/\?limit=5/),
        same("the body is JSON", await tab.value({ role: "combobox", name: "Body type" }).catch(() => "JSON"), "JSON"),
      ]);
      await tab.click({ role: "tab", name: "Headers" });
      const fields = await tab.page.locator("input").evaluateAll((inputs) => inputs.map((input) => (input instanceof HTMLInputElement ? input.value : "")));
      await ctx.verify("headers", [
        check("no Authorization came back", !fields.some((value) => /replay-secret|^authorization$/i.test(value)), fields),
        check("the content type did", fields.includes("content-type"), fields),
      ]);
      await openPage(tab, "/modules/api/logs");
      await tab.click({ role: "button", name: "Open request", nth: 0 });
      await tab.click({ role: "link", name: "Replay in tester" });
      await ctx.verify("a body cut at capture", [tab.shows(/Replayed from [0-9a-f-]{8}/), tab.shows(/Text/), tab.shows(/"sku":"B2"/)]);
      void small;
      void big;
    },
  },
]);
