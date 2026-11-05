import { check, isOn, list, mon, num, pick, same, saveSettings, settled, text, traffic, openPage } from "../../api.mjs";
import { seedLogs } from "../../seed.mjs";
import { listed } from "./shared.mjs";

/** @typedef {import("../../api.mjs").Ctx} Ctx */

/** The logs journeys about list and pause. */
export const listAndPause = [
  {
    id: "the-tabs-the-filters-and-the-search-narrow-the-list",
    title: "the status tabs count 2xx, 4xx and 5xx, Method and Slow narrow the table, the path, route and error links filter it, and the search matches the words of the path and the error",
    entryPoint: "/modules/api/logs and GET /api/monitoring/logs",
    async run(/** @type {Ctx} */ ctx) {
      await saveSettings(ctx, "slow from 50 ms", { requestSlownessThresholdMs: 50 });
      await traffic(ctx, "eleven calls", [
        { path: "/fx/ok", count: 3 }, { path: "/fx/items/7", count: 1 }, { path: "/fx/echo", count: 2, method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
        { path: "/fx/missing", count: 2 }, { path: "/fx/boom", count: 2 }, { path: "/fx/slow?ms=80", count: 1 },
      ]);
      await settled(ctx, "the logs hold 11", "/logs?preset=last-24h", (body) => num(body, "total") === 11);
      const all = await listed(ctx, "all", "");
      const ok = await listed(ctx, "2xx", "filter_statusClass=is:2xx");
      const client = await listed(ctx, "4xx", "filter_statusClass=is:4xx");
      const server = await listed(ctx, "5xx", "filter_statusClass=is:5xx");
      const post = await listed(ctx, "POST", "filter_method=is:POST");
      const methods = await listed(ctx, "GET and PUT", "filter_method=is:GET,PUT");
      const slow = await listed(ctx, "slow", "filter_slow=is:true");
      const route = await listed(ctx, "route", `filter_route=is:${encodeURIComponent("GET /fx/items/:id")}`);
      const path = await listed(ctx, "path", "filter_path=is:%2Ffx%2Fitems%2F7");
      const error = await listed(ctx, "error", `filter_error=is:${encodeURIComponent("fixture not found")}`);
      const search = await listed(ctx, "search", "search=fixture");
      const searchPath = await listed(ctx, "search path", "search=missing");
      const limited = await listed(ctx, "limit", "limit=4");
      await ctx.verify("the API", [
        same("all", all.total, 11),
        same("2xx", [ok.total, [...new Set(ok.paths)].sort()], [7, ["/fx/echo", "/fx/items/7", "/fx/ok", "/fx/slow"]]),
        same("4xx", [client.total, [...new Set(client.paths)]], [2, ["/fx/missing"]]),
        same("5xx", [server.total, [...new Set(server.paths)]], [2, ["/fx/boom"]]),
        same("a method", [post.total, [...new Set(post.paths)]], [2, ["/fx/echo"]]),
        same("two methods (a GET and a PUT)", methods.total, 9),
        same("slow follows the threshold", [slow.total, slow.paths], [1, ["/fx/slow"]]),
        same("the route filter names the route, not the path", [route.total, route.paths], [1, ["/fx/items/7"]]),
        same("the path filter is the raw path", [path.total, path.paths], [1, ["/fx/items/7"]]),
        same("the error filter", [error.total, [...new Set(error.paths)]], [2, ["/fx/missing"]]),
        same("the search matches error words", [search.total, [...new Set(search.paths)].sort()], [4, ["/fx/boom", "/fx/missing"]]),
        same("the search matches path words", [searchPath.total, [...new Set(searchPath.paths)]], [2, ["/fx/missing"]]),
        same("a limit pages the rows and keeps the total", [limited.paths.length, limited.total], [4, 11]),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/logs");
      await ctx.verify("the tabs", [
        tab.visible({ role: "button", name: "All 11" }),
        tab.visible({ role: "button", name: "2xx 7" }),
        tab.visible({ role: "button", name: "4xx 2" }),
        tab.visible({ role: "button", name: "5xx 2" }),
        tab.visible({ role: "button", name: "Slow (≥ 50 ms)" }),
      ]);
      await tab.click({ role: "button", name: "4xx 2" });
      await ctx.verify("the 4xx tab", [tab.shows(/fixture not found/), tab.shows(/fixture boom/, { not: true, timeoutMs: 3000 }), tab.shows(/\/fx\/ok/, { not: true, timeoutMs: 1000 })]);
      await tab.click({ role: "button", name: "All 11" });
      await tab.click({ role: "button", name: "Slow (≥ 50 ms)" });
      await ctx.verify("Slow", [tab.shows(/\/fx\/slow/), tab.shows(/\/fx\/boom/, { not: true, timeoutMs: 3000 })]);
    },
  },
  {
    id: "the-list-is-newest-first-sorts-and-pages",
    title: "the list is newest first, sorts by status and duration, pages by 50 and keeps the total over the pages",
    entryPoint: "GET /api/monitoring/logs?sortKey=...&offset=...",
    async run(/** @type {Ctx} */ ctx) {
      await seedLogs(ctx, "58 ok", { daysAgo: 0.01, count: 58 });
      await seedLogs(ctx, "two not found", { daysAgo: 0.02, count: 2, statusCode: 404, uri: "/fx/missing", message: "seeded" });
      const first = await listed(ctx, "first page", "");
      const second = await listed(ctx, "second page", "offset=50");
      const byStatus = await mon(ctx, "by status", "/logs?preset=last-24h&sortKey=status&sortDirection=asc&limit=3");
      const byStatusDesc = await mon(ctx, "by status, descending", "/logs?preset=last-24h&sortKey=status&sortDirection=desc&limit=3");
      const oldest = await mon(ctx, "oldest first", "/logs?preset=last-24h&sortKey=timestamp&sortDirection=asc&limit=2");
      const newest = await mon(ctx, "newest first", "/logs?preset=last-24h&limit=2");
      await ctx.verify("paging", [
        same("the total", first.total, 60),
        same("the first page holds 50 rows", first.paths.length, 50),
        same("the second page holds the other 10", second.paths.length, 10),
        same("status ascending starts with a 200", list(byStatus.body, "results").map((row) => text(row, "status")), ["200", "200", "200"]),
        same("status descending starts with the 404s", list(byStatusDesc.body, "results").map((row) => text(row, "status")).slice(0, 2), ["404", "404"]),
        check("newest first", Date.parse(text(list(newest.body, "results")[0], "timestamp")) > Date.parse(text(list(oldest.body, "results")[0], "timestamp")), pick(newest.body, "total")),
        same("the oldest rows are the two 404s", list(oldest.body, "results").map((row) => text(row, "status")), ["404", "404"]),
      ]);
    },
  },
  {
    id: "pause-holds-the-table-and-counts-what-was-missed",
    title: "Pause stops the reads: the toolbar counts the new requests and the 5xx among them, the table keeps its rows and offers Show; Show reads them",
    entryPoint: "/modules/api/logs",
    async run(/** @type {Ctx} */ ctx) {
      await traffic(ctx, "before the pause", [{ path: "/fx/ok", count: 2 }]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/logs");
      await ctx.verify("live", [isOn(tab, { role: "button", name: "Live" }), tab.visible({ role: "button", name: "All 2" })]);
      await tab.click({ role: "button", name: "Pause" });
      await traffic(ctx, "while paused", [{ path: "/fx/ok", count: 2 }, { path: "/fx/boom", count: 1 }]);
      await ctx.verify("paused", [
        isOn(tab, { role: "button", name: "Pause" }),
        tab.shows(/Paused · 3 new requests · 1 in 5xx/),
        tab.visible({ role: "button", name: "Show", exact: true }),
        tab.visible({ role: "button", name: "All 2" }),
        tab.shows(/\/fx\/boom/, { not: true, timeoutMs: 1500 }),
      ]);
      await tab.click({ role: "button", name: "Show", exact: true });
      await ctx.verify("shown", [tab.visible({ role: "button", name: "All 5" }), tab.shows(/\/fx\/boom/)]);
      await tab.click({ role: "button", name: "Pause" });
      await openPage(tab, "/modules/api/overview");
      await ctx.verify("the choice applies to the Overview", [isOn(tab, { role: "button", name: "Pause" })]);
      await openPage(tab, "/modules/api/routes");
      await ctx.verify("and to Routes", [isOn(tab, { role: "button", name: "Pause" })]);
      await tab.click({ role: "button", name: "Live" });
      await openPage(tab, "/modules/api/logs");
      await ctx.verify("and back to Live everywhere", [isOn(tab, { role: "button", name: "Live" })]);
    },
  },
];
