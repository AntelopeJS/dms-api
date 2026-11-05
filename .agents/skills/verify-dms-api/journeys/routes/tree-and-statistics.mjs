import { FIXTURE_ROUTES, check, list, mon, num, pick, same, saveSettings, settled, text, traffic, openPage } from "../../api.mjs";
import { named, detail } from "./shared.mjs";

/** @typedef {import("../../api.mjs").Ctx} Ctx */

/** The routes journeys about tree and statistics. */
export const treeAndStatistics = [
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
        same("routes in scope", rows.length, FIXTURE_ROUTES),
        check("the project's folders", ["/fx/items", "/fx/orders", "/fx/guarded"].every((folder) => rows.some((row) => text(row, "folder") === folder)), [...new Set(rows.map((row) => text(row, "folder")))]),
        same("a route's counts and state", [num(byRef("GET /fx/boom"), "requests"), text(byRef("GET /fx/boom"), "state")], [25, "failing"]),
        same("a quiet route", [num(byRef("GET /fx/ok"), "requests"), text(byRef("GET /fx/ok"), "state")], [3, "healthy"]),
        same("an uncalled route", [num(byRef("GET /fx/blob"), "requests"), text(byRef("GET /fx/blob"), "state")], [0, "idle"]),
        same("the window health reads", num(listed.body, "healthWindowMinutes"), 1440),
        same("the folders: the first static segments up to a parameter, at most two", ["GET /fx/ok", "GET /fx/items/:id", "POST /fx/orders/:shop/lines", "GET /fx/guarded/secret", "POST /verify-api/member"].map((ref) => text(byRef(ref), "folder")), ["/fx/ok", "/fx/items", "/fx/orders", "/fx/guarded", "/verify-api/member"]),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/routes");
      const posts = rows.filter((row) => text(row, "method") === "POST").length;
      await tab.click({ role: "button", name: new RegExp(`^[A-Z]+ /\\S+ ${FIXTURE_ROUTES}$`) });
      await ctx.verify("the tree", [
        tab.shows(new RegExp(`${FIXTURE_ROUTES} of ${FIXTURE_ROUTES} routes · \\d+ folders`)),
        tab.visible({ role: "treeitem", name: /^GET \/fx\/boom 25\b/ }),
        tab.visible({ role: "treeitem", name: /^GET \/fx\/ok 3\b/ }),
        tab.visible({ role: "treeitem", name: /^GET \/fx\/items\/:id 1\b/ }),
        tab.visible({ role: "treeitem", name: "GET /fx/blob 0 No traffic" }),
        tab.visible({ role: "treeitem", name: "DEL /fx/items/:id 0 No traffic" }),
      ]);
      await tab.fill({ role: "textbox", name: "Filter by path or handler" }, "items");
      await ctx.verify("the path filter", [tab.shows(new RegExp(`3 of ${FIXTURE_ROUTES} routes · 1 folder`)), tab.visible({ role: "treeitem", name: "GET /fx/boom 25 Failing" }, { hidden: true, timeoutMs: 4000 })]);
      await tab.fill({ role: "textbox", name: "Filter by path or handler" }, "boom");
      await ctx.verify("the handler filter", [tab.shows(new RegExp(`2 of ${FIXTURE_ROUTES} routes`)), tab.visible({ role: "treeitem", name: /^GET \/fx\/boom-twin\b/ })]);
      await tab.fill({ role: "textbox", name: "Filter by path or handler" }, "identify");
      await ctx.verify("a handler name the path does not hold", [tab.shows(new RegExp(`1 of ${FIXTURE_ROUTES} routes`)), tab.visible({ role: "treeitem", name: /^GET \/fx\/who\b/ })]);

      await tab.fill({ role: "textbox", name: "Filter by path or handler" }, "");
      await tab.click({ role: "radio", name: "POST" });
      await ctx.verify("the method filter", [tab.shows(new RegExp(`${posts} of ${FIXTURE_ROUTES} routes`)), tab.visible({ role: "treeitem", name: /^POST \/fx\/echo/ }), tab.visible({ role: "treeitem", name: /^GET \/fx\/ok/ }, { hidden: true, timeoutMs: 4000 })]);
      await tab.click({ role: "radio", name: "All" });
      await tab.click({ role: "switch", name: "Only routes needing attention" });
      await ctx.verify("only routes needing attention", [tab.shows(new RegExp(`1 of ${FIXTURE_ROUTES} routes`)), tab.visible({ role: "treeitem", name: /GET \/fx\/boom/ }), tab.visible({ role: "treeitem", name: /^GET \/fx\/ok/ }, { hidden: true, timeoutMs: 4000 })]);
      await tab.click({ role: "switch", name: "Only routes needing attention" });
      await tab.click({ role: "switch", name: /^Hide routes without traffic/ });
      await ctx.verify("hide routes without traffic", [tab.shows(new RegExp(`3 of ${FIXTURE_ROUTES} routes`)), tab.visible({ role: "treeitem", name: /^GET \/fx\/blob/ }, { hidden: true, timeoutMs: 4000 })]);
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
      await openPage(tab, "/modules/api/routes");
      await ctx.verify("no route named: the one needing attention", [check("the URL names the failing route", /route=GET\+%2Ffx%2Fboom/.test(tab.page.url()), tab.page.url()), tab.shows(/FixtureController\.boom/), tab.shows(/(Failing|Down)[^\n]*last 24 h/)]);
      await openPage(tab, "/modules/api/routes?route=GET+%2Ffx%2Fok&tab=documentation");
      await ctx.verify("the named route and tab", [
        tab.shows(/\/fx\/ok · FixtureController/),
        tab.shows(/(No traffic|Healthy) · last 24 h\s+FixtureController\.ok\s+Auth unknown\s+Project code/),
                tab.shows(/EXAMPLE REQUEST/),
      ]);
      await tab.click({ role: "link", name: "Requests" });
      await ctx.verify("Requests", [tab.at(/\/modules\/api\/logs$/), check("the logs narrow to the route", /route=GET\+%2Ffx%2Fok/.test(tab.page.url()), tab.page.url())]);
      await openPage(tab, "/modules/api/routes");
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
      const summary = await settled(ctx, "summary", `/routes/statistics/summary?${named(ref)}&preset=last-24h`, (body) => num(list(body, "items").find((item) => text(item, "id") === "requests"), "value") === 18);
      await settled(ctx, "errors counted", `/routes/statistics/errors?${named(ref)}&preset=last-24h`, (body) => list(body, "items").length === 1);
      const errors = await mon(ctx, "top errors", `/routes/statistics/errors?${named(ref)}&preset=last-24h`);
      const activity = await mon(ctx, "activity", `/routes/statistics/activity?${named(ref)}&preset=last-24h`);
      const status = await mon(ctx, "status chart", `/routes/statistics/status?${named(ref)}&preset=last-24h`);
      const cards = new Map(list(summary.body, "items").map((item) => [text(item, "id"), item]));
      await ctx.verify("the API", [
        same("the request count", num(cards.get("requests"), "value"), 18),
        same("the error rate is 4 of 18", Math.round((num(cards.get("errors"), "value", "params", "rate", "value") ?? 0) * 1000) / 1000, 0.222),
        same("the error split is 4 client errors and no server error", [num(cards.get("errors"), "detail", "params", "client", "value"), num(cards.get("errors"), "detail", "params", "server", "value")], [4, 0]),
        same("the slow line names the threshold", num(cards.get("max"), "detail", "params", "threshold", "params", "value", "value"), 50),
        same("the top errors group the four 404s under one message", list(errors.body, "items").map((item) => [num(item, "status"), text(item, "message"), num(item, "value")]), [[404, "no such item", 4]]),
        same("the activity counts the calls", num(activity.body, "calls"), 18),
        same("the status chart's figure is the error rate in percent", num(status.body, "value"), 22.2),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, `/modules/api/routes?${named(ref)}&tab=statistics`);
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
];
