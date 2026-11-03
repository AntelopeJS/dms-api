import { guarded } from "../guard.mjs";
import { check, list, mon, num, pick, raw, same, saveSettings, settled, text, traffic, withConfig } from "../api.mjs";

/** @typedef {import("../api.mjs").Ctx} Ctx */

/**
 * @param {string} ref A route reference such as `GET /fx/ok`
 * @returns {string} The query string that names it
 */
const named = (ref) => `route=${encodeURIComponent(ref)}`;

/**
 * @param {Ctx} ctx The journey
 * @param {string} ref The route
 * @returns {Promise<import("../api.mjs").Answer>} The route's detail
 */
const detail = (ctx, ref) => mon(ctx, `detail of ${ref}`, `/routes/detail?${named(ref)}`);

export const journeys = guarded([
  {
    id: "the-tree-groups-routes-by-folder-and-the-filters-narrow-it",
    title: "the tree lists every route of the scope grouped by path prefix with its call count and health, and the path filter, the method filter, Only routes needing attention and Hide routes without traffic narrow it",
    entryPoint: "/modules/api/routes",
    async run(/** @type {Ctx} */ ctx) {
      await traffic(ctx, "three routes", [{ path: "/fx/ok", count: 3 }, { path: "/fx/boom", count: 25 }, { path: "/fx/items/7", count: 1 }]);
      const listed = await settled(ctx, "the tree", "/routes/list", (body) => list(body, "routes").some((row) => text(row, "ref") === "GET /fx/boom" && num(row, "requests") === 25));
      const rows = list(listed.body, "routes");
      const byRef = (/** @type {string} */ ref) => rows.find((row) => text(row, "ref") === ref);
      await ctx.verify("the list", [
        same("routes in scope", rows.length, 15),
        check("the project's folders", ["/fx/items", "/fx/orders", "/fx/guarded"].every((folder) => rows.some((row) => text(row, "folder") === folder)), [...new Set(rows.map((row) => text(row, "folder")))]),
        same("a route's counts and state", [num(byRef("GET /fx/boom"), "requests"), text(byRef("GET /fx/boom"), "state")], [25, "failing"]),
        same("a quiet route", [num(byRef("GET /fx/ok"), "requests"), text(byRef("GET /fx/ok"), "state")], [3, "healthy"]),
        same("an uncalled route", [num(byRef("GET /fx/blob"), "requests"), text(byRef("GET /fx/blob"), "state")], [0, "idle"]),
        same("the window health reads", num(listed.body, "healthWindowMinutes"), 1440),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto("/modules/api/routes");
      const folders = new Set(rows.map((row) => text(row, "folder"))).size;
      const posts = rows.filter((row) => text(row, "method") === "POST").length;
      await ctx.verify("the tree", [
        tab.shows(new RegExp(`15 of 15 routes · ${folders} folders`)),
        tab.visible({ role: "treeitem", name: "GET /fx/boom 25 Failing" }),
        tab.visible({ role: "treeitem", name: "GET /fx/ok 3 Healthy" }),
        tab.visible({ role: "treeitem", name: "GET /fx/blob 0 No traffic" }),
        tab.visible({ role: "treeitem", name: "DEL /fx/items/:id 0 No traffic" }),
      ]);
      await tab.fill({ role: "textbox", name: "Filter by path or handler" }, "items");
      await ctx.verify("the path filter", [tab.shows(/3 of 15 routes · 1 folder/), tab.visible({ role: "treeitem", name: "GET /fx/boom 25 Failing" }, { hidden: true, timeoutMs: 4000 })]);
      await tab.fill({ role: "textbox", name: "Filter by path or handler" }, "boom");
      await ctx.verify("the handler filter", [tab.shows(/1 of 15 routes/)]);
      await tab.fill({ role: "textbox", name: "Filter by path or handler" }, "");
      await tab.click({ role: "radio", name: "POST" });
      await ctx.verify("the method filter", [tab.shows(new RegExp(`${posts} of 15 routes`)), tab.visible({ role: "treeitem", name: /^POST \/fx\/echo/ }), tab.visible({ role: "treeitem", name: /^GET \/fx\/ok/ }, { hidden: true, timeoutMs: 4000 })]);
      await tab.click({ role: "radio", name: "All" });
      await tab.click({ role: "switch", name: "Only routes needing attention" });
      await ctx.verify("only routes needing attention", [tab.shows(/1 of 15 routes/), tab.visible({ role: "treeitem", name: "GET /fx/boom 25 Failing" }), tab.visible({ role: "treeitem", name: /^GET \/fx\/ok/ }, { hidden: true, timeoutMs: 4000 })]);
      await tab.click({ role: "switch", name: "Only routes needing attention" });
      await tab.click({ role: "switch", name: /^Hide routes without traffic/ });
      await ctx.verify("hide routes without traffic", [tab.shows(/3 of 15 routes/), tab.visible({ role: "treeitem", name: /^GET \/fx\/blob/ }, { hidden: true, timeoutMs: 4000 })]);
    },
  },
  {
    id: "a-route-opens-with-its-header-and-the-url-names-it",
    title: "the page opens the route and the tab the URL names, shows its method, path, controller, handler, origin and first-seen date, Requests opens the logs on the route, and a page opened with no route lands on the last route opened, else the one needing attention",
    entryPoint: "/modules/api/routes?route=...&tab=...",
    async run(/** @type {Ctx} */ ctx) {
      await traffic(ctx, "two routes", [{ path: "/fx/ok", count: 2 }, { path: "/fx/boom", count: 25 }]);
      await settled(ctx, "the tree", "/routes/list", (body) => list(body, "routes").some((row) => text(row, "ref") === "GET /fx/boom" && num(row, "requests") === 25));
      const ok = await detail(ctx, "GET /fx/ok");
      const missing = await detail(ctx, "GET /fx/never");
      await ctx.verify("the detail", [
        same("identity", [text(ok.body, "ref"), text(ok.body, "controller"), text(ok.body, "handler"), pick(ok.body, "own"), text(ok.body, "module")], ["GET /fx/ok", "FixtureController", "ok", true, "app"]),
        check("the snippets use the DMS apiBaseUrl", text(ok.body, "apiOrigin") === ctx.state.webUrl || text(ok.body, "apiOrigin") === ctx.state.apiUrl, text(ok.body, "apiOrigin")),
        same("the first-seen date is today", text(ok.body, "registeredAt").slice(0, 10), new Date().toISOString().slice(0, 10)),
        same("an unknown route is a 404", missing.status, 404),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto("/modules/api/routes");
      await ctx.verify("no route named: the one needing attention", [check("the URL names the failing route", /route=GET\+%2Ffx%2Fboom/.test(tab.page.url()), tab.page.url()), tab.shows(/FixtureController\.boom/), tab.shows(/(Failing|Down) · last 24 h/)]);
      await tab.goto("/modules/api/routes?route=GET+%2Ffx%2Fok&tab=documentation");
      await ctx.verify("the named route and tab", [
        tab.shows(/\/fx\/ok · FixtureController/),
        tab.shows(/(No traffic|Healthy) · last 24 h\s+FixtureController\.ok\s+Auth unknown\s+Project code/),
                tab.shows(/EXAMPLE REQUEST/),
      ]);
      await tab.click({ role: "link", name: "Requests" });
      await ctx.verify("Requests", [tab.at(/\/modules\/api\/logs$/), check("the logs narrow to the route", /route=GET\+%2Ffx%2Fok/.test(tab.page.url()), tab.page.url())]);
      await tab.goto("/modules/api/routes");
      await ctx.verify("the last route opened", [check("it lands on GET /fx/ok", /route=GET\+%2Ffx%2Fok/.test(tab.page.url()), tab.page.url())]);
    },
  },
  {
    id: "the-statistics-tab-adds-up-the-period",
    title: "the Statistics tab shows the requests, average and p95 latency, error rate with its 4xx and 5xx counts, the slowest call, the top errors grouped by status and message, and the recent calls, for the route and the period",
    entryPoint: "/modules/api/routes?route=GET /fx/boom, /api/monitoring/routes/statistics/*",
    async run(/** @type {Ctx} */ ctx) {
      await saveSettings(ctx, "slow from 50 ms", { requestSlownessThresholdMs: 50 });
      await traffic(ctx, "one route", [{ path: "/fx/items/7", count: 14 }, { path: "/fx/items/x1", count: 4 }, { path: "/fx/slow?ms=80", count: 2 }]);
      const ref = "GET /fx/items/:id";
      const summary = await settled(ctx, "summary", `/routes/statistics/summary?${named(ref)}&preset=last-24h`, (body) => JSON.stringify(body).includes("18"));
      const errors = await mon(ctx, "top errors", `/routes/statistics/errors?${named(ref)}&preset=last-24h`);
      const activity = await mon(ctx, "activity", `/routes/statistics/activity?${named(ref)}&preset=last-24h`);
      const status = await mon(ctx, "status chart", `/routes/statistics/status?${named(ref)}&preset=last-24h`);
      await ctx.verify("the API", [
        check("the summary counts 18 calls", JSON.stringify(summary.body).includes("18"), summary.body),
        check("the top errors group the four 404s", JSON.stringify(errors.body).includes("no such item") && JSON.stringify(errors.body).includes("404"), errors.body),
        check("the activity says the route was called", JSON.stringify(activity.body).includes("true") || JSON.stringify(activity.body).includes("18"), activity.body),
        same("the status chart answers", status.status, 200),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto(`/modules/api/routes?${named(ref)}&tab=statistics`);
      await ctx.verify("the tab", [
        tab.shows(/REQUESTS\s+18\s/),
        tab.shows(/ERROR RATE\s+22\.2%\s+4 × 4xx · 0 × 5xx/),
        tab.shows(/TOP ERRORS/),
        tab.shows(/404 · no such item\s+Client error/),
        tab.shows(/RECENT REQUESTS/),
        tab.shows(/SLOWEST CALL\s+\d+ ms\s+slow above 50 ms/),
        tab.shows(/\/fx\/items\/x1/),
      ]);
    },
  },
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
      await tab.goto(`/modules/api/routes?${named(ref)}&tab=documentation`);
      const origin = text(found.body, "apiOrigin");
      await ctx.verify("the tab", [
        tab.shows(/Read from the requests captured over the last 7 days \(the tester's left out\) and from the handler's code\. What was never called does not show\./),
        tab.shows(new RegExp(`curl -X POST '${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/fx/orders/shop1/lines\\?limit=5'`)),
        tab.shows(/Authentication unknown/),
        tab.shows(/BODY\s+Inferred from 1 successful request/),
        tab.shows(/sku\s+required\s+e\.g\. "A1"\s+string/),
        tab.shows(/quantity\s+required\s+e\.g\. 2\s+number/),
        tab.shows(/:shop\s+string\s+required\s+e\.g\. shop1/),
        tab.shows(/limit\s+object\s+e\.g\. 5/),
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
      await tab.goto(`/modules/api/routes?${named("GET /fx/guarded/secret")}`);
      await ctx.verify("the header of the guarded route", [tab.shows(/GuardedController\.secret/), tab.shows(/Auth unknown/, { not: true, timeoutMs: 3000 })]);
      await tab.goto(`/modules/api/routes?${named("GET /fx/named/page")}`);
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
]);
