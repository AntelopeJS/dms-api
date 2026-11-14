import { seedLogs } from "../../seed.mjs";
import { list, mon, num, pick, raw, same, settled, text, withConfig, openPage } from "../../api.mjs";
import { named, detail } from "./shared.mjs";

/** @typedef {import("../../api.mjs").Ctx} Ctx */

/** The routes journeys about documentation. */
export const documentation = [
  {
    id: "the-documentation-tab-is-inferred-from-the-code-and-the-traffic",
    title: "the Documentation tab shows an example request in cURL and fetch, the path, query and header parameters with examples and whether they are required, the body fields, the statuses seen and the response, from the last 7 days of captured calls, and shows nothing for what was never called",
    entryPoint: "/modules/api/routes?route=POST /fx/orders/:shop/lines&tab=documentation",
    async run(/** @type {Ctx} */ ctx) {
      await raw(ctx, "a call", { method: "POST", path: "/fx/orders/shop1/lines?limit=5", headers: { "content-type": "application/json", "x-tenant": "t9" }, body: JSON.stringify({ sku: "A1", quantity: 2 }) });
      const ref = "POST /fx/orders/:shop/lines";
      const found = await settled(ctx, "the contract", `/routes/detail?${named(ref)}`, (body) => num(body, "contract", "total") === 1);
      const never = await detail(ctx, "GET /fx/blob");
      const parameters = list(found.body, "parameters").map((entry) => [text(entry, "name"), text(entry, "in"), pick(entry, "required"), pick(entry, "example")]);
      await ctx.verify("the contract", [
        same("the parameters", parameters, [["shop", "path", true, "shop1"], ["limit", "query", false, "5"], ["x-tenant", "header", false, null]]),
        same("the body fields", list(found.body, "contract", "bodyFields").map((entry) => [text(entry, "name"), pick(entry, "required"), pick(entry, "example")]), [["sku", true, "A1"], ["quantity", true, 2]]),
        same("the statuses seen", list(found.body, "contract", "statuses").map((entry) => [num(entry, "status"), num(entry, "count")]), [[201, 1]]),
        same("the example path and query", [pick(found.body, "contract", "examplePath"), pick(found.body, "contract", "exampleQuery")], [{ shop: "shop1" }, { limit: "5" }]),
        same("a route never called has no statuses, fields or example", [num(never.body, "contract", "total"), list(never.body, "contract", "statuses").length, list(never.body, "contract", "bodyFields").length, pick(never.body, "contract", "exampleResponse")], [0, 0, 0, null]),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, `/modules/api/routes?${named(ref)}&tab=documentation`);
      const origin = text(found.body, "apiOrigin");
      await ctx.verify("the tab", [
        tab.shows(/Read from the requests captured over the last 7 days \(the tester's left out\) and from the handler's code\. What was never called does not show\./),
        tab.shows(new RegExp(`curl -X POST '${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/fx/orders/shop1/lines\\?limit=5'`)),
        tab.shows(/Authentication unknown/),
        tab.shows(/BODY\s+Inferred from 1 successful request/),
        tab.shows(/sku\s+required\s+e\.g\. "A1"\s+string/),
        tab.shows(/quantity\s+required\s+e\.g\. 2\s+number/),
        tab.shows(/:shop\s+string\s+required\s+e\.g\. shop1/),
        tab.shows(/limit\s+number\s+e\.g\. 5/),
        tab.shows(/x-tenant\s+object\s+no successful call yet/),
        tab.shows(/201\s+Created\s+seen once in 7 days/),
        tab.shows(/1\s+start[\s\S]*2\s+cors[\s\S]*3\s+OrdersController\.add[\s\S]*4\s+capture/),
      ]);
      await tab.click({ role: "radio", name: "fetch" });
      await ctx.verify("fetch", [tab.shows(/fetch\(/)]);
    },
  },
  {
    id: "authentication-is-read-from-the-guards-before-the-handler",
    title: "a route behind a middleware named auth_check reads as authenticated, one behind checkTicket only once authMiddlewareCallbacks names it, a handler that checks inside reads Auth unknown until a 401 is seen, and a route with no guard reads Auth unknown",
    entryPoint: "GET /api/monitoring/routes/detail and the route header",
    async run(/** @type {Ctx} */ ctx) {
      await raw(ctx, "guarded, refused", { path: "/fx/guarded/secret" });
      await raw(ctx, "guarded, allowed", { path: "/fx/guarded/secret", headers: { authorization: "Bearer letmein" } });
      const authOf = async (/** @type {string} */ ref, /** @type {string} */ wait) => (await settled(ctx, ref, `/routes/detail?${named(ref)}`, (body) => wait === "" || num(body, "contract", "total") === Number(wait))).body;
      const before = {
        guarded: await authOf("GET /fx/guarded/secret", "2"),
        named: await authOf("GET /fx/named/page", ""),
        inline: await authOf("GET /fx/inline/private", ""),
        plain: await authOf("GET /fx/ok", ""),
      };
      await raw(ctx, "inline, refused", { path: "/fx/inline/private" });
      const probable = await authOf("GET /fx/inline/private", "1");
      await ctx.verify("the default patterns", [
        same("auth_check is a guard", [pick(before.guarded, "auth", "status"), pick(before.guarded, "auth", "guards"), pick(before.guarded, "requiresAuth")], ["required", ["auth_check"], true]),
        same("checkTicket matches no default pattern", [pick(before.named, "auth", "status"), pick(before.named, "requiresAuth")], ["unknown", false]),
        same("an inline check does not show", [pick(before.inline, "auth", "status"), pick(before.inline, "auth", "guards")], ["unknown", []]),
        same("no guard reads unknown", pick(before.plain, "auth", "status"), "unknown"),
        same("a 401 seen turns unknown into probable", [pick(probable, "auth", "status"), pick(probable, "auth", "unauthorized")], ["probable", 1]),
        same("the pipeline marks the guard", list(before.guarded, "pipeline").filter((step) => pick(step, "isAuth") === true).map((step) => text(step, "name")), ["auth_check", "GuardedController.secret"]),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, `/modules/api/routes?${named("GET /fx/guarded/secret")}`);
      await ctx.verify("the header of the guarded route", [tab.shows(/GuardedController\.secret/), tab.shows(/Auth unknown/, { not: true, timeoutMs: 3000 })]);
      await openPage(tab, `/modules/api/routes?${named("GET /fx/named/page")}`);
      await ctx.verify("the header of the unguarded route", [tab.shows(/Auth unknown/)]);
      await withConfig(ctx, { authMiddlewareCallbacks: ["checkTicket"], authMiddlewareNamePatterns: ["^never_"] }, async () => {
        const configured = {
          named: await authOf("GET /fx/named/page", ""),
          guarded: await authOf("GET /fx/guarded/secret", ""),
        };
        await ctx.verify("the configuration", [
          same("authMiddlewareCallbacks names checkTicket", [pick(configured.named, "auth", "status"), pick(configured.named, "auth", "guards")], ["required", ["checkTicket"]]),
          same("replacing the patterns drops auth_check", pick(configured.guarded, "auth", "guards"), []),
        ]);
      });
    },
  },
  {
    id: "the-contract-reads-seven-days-of-real-calls-and-never-the-testers",
    title: "a call 6 days old shapes the documentation, one 8 days old does not, and a call the Tester made leaves its totals, fields, statuses and examples unchanged",
    entryPoint: "GET /api/monitoring/routes/detail",
    async run(/** @type {Ctx} */ ctx) {
      const ref = "POST /fx/orders/:shop/lines";
      const uri = "/fx/orders/:shop/lines";
      await seedLogs(ctx, "8 days old", { daysAgo: 8, count: 1, method: "POST", uri, statusCode: 201, requestBody: JSON.stringify({ sku: "OLD", legacy: true }), responseBody: JSON.stringify({ shop: "old" }) });
      await seedLogs(ctx, "6 days old", { daysAgo: 6, count: 1, method: "POST", uri, statusCode: 201, requestBody: JSON.stringify({ sku: "R6", recent: true }), responseBody: JSON.stringify({ shop: "recent" }) });
      await raw(ctx, "a real call", { method: "POST", path: "/fx/orders/shop1/lines?limit=5", headers: { "content-type": "application/json" }, body: JSON.stringify({ sku: "A1", quantity: 2 }) });
      const before = await settled(ctx, "the contract", `/routes/detail?${named(ref)}`, (body) => num(body, "contract", "total") === 2);
      const token = text((await mon(ctx, "ask a Tester token", "/tester/source")).body, "value");
      await raw(ctx, "a Tester call with its own fields", { method: "POST", path: "/fx/orders/shop9/lines?viaTester=1", headers: { "content-type": "application/json", "x-antelopejs-api-source": token }, body: JSON.stringify({ sku: "T9", quantity: 9, viaTester: true }) });
      await settled(ctx, "the Tester call is stored", "/logs?limit=50", (body) => list(body, "results").some((row) => text(row, "source") === "tester"));
      await new Promise((resolve) => setTimeout(resolve, 16_000));
      const after = await mon(ctx, "the contract after the Tester call", `/routes/detail?${named(ref)}`);
      const summarize = (/** @type {unknown} */ body) => ({
        total: num(body, "contract", "total"),
        fields: list(body, "contract", "bodyFields").map((entry) => [text(entry, "name"), pick(entry, "required")]).toSorted((left, right) => String(left[0]).localeCompare(String(right[0]))),
        statuses: list(body, "contract", "statuses").map((entry) => [num(entry, "status"), num(entry, "count")]),
        query: pick(body, "contract", "queryParams"),
        example: pick(body, "contract", "exampleBody"),
      });
      await ctx.verify("seven days", [
        same("only the calls of the last 7 days count", summarize(before.body).total, 2),
        same("the 6 day old call's field is documented, the 8 day old one's is not, and a field missing from a call is not required", summarize(before.body).fields, [["quantity", false], ["recent", false], ["sku", true]]),
        same("the statuses seen", summarize(before.body).statuses, [[201, 2]]),
      ]);
      await ctx.verify("the Tester", [
        same("the contract is the same after a Tester call", summarize(after.body), summarize(before.body)),
        same("the Tester's field is not documented", summarize(after.body).fields.map((entry) => entry[0]).includes("viaTester"), false),
        same("the Tester's query parameter is not documented", summarize(after.body).query, ["limit"]),
      ]);
    },
  },
];
