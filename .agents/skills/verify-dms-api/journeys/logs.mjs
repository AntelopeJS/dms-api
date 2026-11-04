import { guarded } from "../guard.mjs";
import { check, isOn, list, mon, num, pick, raw, same, saveSettings, settled, text, traffic, openPage } from "../api.mjs";
import { seedLogs } from "../seed.mjs";

/** @typedef {import("../api.mjs").Ctx} Ctx */

/**
 * @param {Ctx} ctx The journey
 * @param {string} label What is asked
 * @param {string} query The list query
 * @returns {Promise<{ total: number | undefined, paths: string[], messages: string[] }>} What the list holds
 */
async function listed(ctx, label, query) {
  const answer = await mon(ctx, label, `/logs?preset=last-24h&${query}`);
  const rows = list(answer.body, "results");
  return { total: num(answer.body, "total"), paths: rows.map((row) => text(row, "path")), messages: rows.map((row) => text(row, "message")) };
}

export const journeys = guarded([
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
    },
  },
  {
    id: "the-histogram-bars-follow-the-period",
    title: "the chart above the logs keeps a bar per minute over 1H, 15 minutes over 24H, 2 hours over 7D and 6 hours over 30D and All time, counts every request by class whatever the table filters, and says a past range is not live",
    entryPoint: "GET /api/monitoring/logs/live",
    async run(/** @type {Ctx} */ ctx) {
      await traffic(ctx, "mixed", [{ path: "/fx/ok", count: 3 }, { path: "/fx/missing", count: 2 }, { path: "/fx/boom", count: 1 }]);
      await settled(ctx, "counted", "/logs/live?preset=last-hour", (body) => num(body, "total") === 6);
      /** @type {[string, number, number][]} */
      const presets = [["last-hour", 60_000, 60], ["last-24h", 900_000, 96], ["last-7-days", 7_200_000, 84], ["last-30-days", 21_600_000, 120], ["all", 21_600_000, 120]];
      const answers = [];
      for (const [preset] of presets) answers.push(await mon(ctx, `histogram ${preset}`, `/logs/live?preset=${preset}`));
      await ctx.verify("the bars", presets.flatMap(([preset, size, bars], index) => [
        same(`${preset}: bar length and count`, [num(answers[index]?.body, "bucketMs"), list(answers[index]?.body, "buckets").length], [size, bars]),
        same(`${preset}: the totals`, [num(answers[index]?.body, "total"), num(answers[index]?.body, "clientErrors"), num(answers[index]?.body, "serverErrors")], [6, 2, 1]),
        same(`${preset}: live while the period reaches now`, pick(answers[index]?.body, "live"), true),
      ]));
      const sum = list(answers[0]?.body, "buckets").reduce((all, bucket) => [all[0] + (num(bucket, "success") ?? 0), all[1] + (num(bucket, "clientErrors") ?? 0), all[2] + (num(bucket, "serverErrors") ?? 0)], [0, 0, 0]);
      /** @type {[number, number, number][]} */
      const ranges = [[3, 2, 900_000], [6, 1, 3_600_000], [20, 10, 7_200_000], [50, 2, 21_600_000], [0.1, 0.05, 60_000]];
      const pasts = [];
      for (const [startDays, endDays] of ranges) {
        const from = new Date(Date.now() - startDays * 86_400_000).toISOString();
        const to = new Date(Date.now() - endDays * 86_400_000).toISOString();
        pasts.push(await mon(ctx, `a past range from ${startDays} to ${endDays} days ago`, `/logs/live?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));
      }
      await ctx.verify("past ranges", pasts.flatMap((past, index) => {
        const [startDays, endDays, size] = ranges[index] ?? [0, 0, 0];
        const bars = list(past.body, "buckets").length;
        return [
          same(`${startDays} to ${endDays} days ago: the bar length`, num(past.body, "bucketMs"), size),
          check(`${startDays} to ${endDays} days ago: 50 to 121 bars (the docs say 50 to 120; the last bar closes the range)`, bars >= 50 && bars <= 121, bars),
          same(`${startDays} to ${endDays} days ago: not live and empty`, [pick(past.body, "live"), num(past.body, "total")], [false, 0]),
        ];
      }));
      const chosen = await mon(ctx, "a bar length asked for", "/logs/live?preset=last-24h&bucket=3600000");
      const tooSmall = await mon(ctx, "a bar length that would need too many bars", "/logs/live?preset=last-24h&bucket=1000");
      await ctx.verify("the rest", [
        same("the bars add up to the requests by class", sum, [3, 2, 1]),
        same("a bar length asked for within the cap is used", num(chosen.body, "bucketMs"), 3_600_000),
        check("a bar length beyond the cap is not used", num(tooSmall.body, "bucketMs") !== 1000 && list(tooSmall.body, "buckets").length <= 120, num(tooSmall.body, "bucketMs")),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/logs");
      await ctx.verify("the chart caption", [
        tab.shows(/Requests per 15 min · last 24 h · all traffic/i),
        tab.shows(/Kept 30 days · bodies up to 64 KB/),
        tab.shows(/6 requests/),
      ]);
      await tab.click({ role: "radio", name: "Last hour" });
      await ctx.verify("1H", [tab.shows(/Requests per minute · last hour · all traffic/i)]);
      await tab.click({ role: "radio", name: "All time" });
      await ctx.verify("All time", [tab.shows(/Requests per 6 h · all kept logs · all traffic/i)]);
    },
  },
  {
    id: "a-request-opens-in-a-drawer-that-steps-through-the-list",
    title: "a row opens the request in a drawer titled with its method and path and its position over the whole result; Next, Previous, J and K step; ?record names it and a reload opens it again; Summary, Request and Response show what was captured; Replay in tester and Same error follow its links",
    entryPoint: "/modules/api/logs?record=<id>",
    async run(/** @type {Ctx} */ ctx) {
      await traffic(ctx, "four calls", [{ path: "/fx/ok", count: 1 }, { path: "/fx/items/7", count: 1 }, { path: "/fx/boom", count: 2 }]);
      await raw(ctx, "a call with a body", { method: "POST", path: "/fx/orders/shop1/lines?limit=5", headers: { "content-type": "application/json" }, body: JSON.stringify({ sku: "A1", quantity: 2 }) });
      await settled(ctx, "the logs", "/logs", (body) => num(body, "total") === 5);
      const answerLength = Buffer.byteLength(JSON.stringify({ shop: "shop1", limit: "5", line: { sku: "A1", quantity: 2 } }));
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/logs");
      await tab.click({ role: "button", name: "Open request", nth: 0 });
      await ctx.verify("the newest request", [tab.visible({ role: "dialog", name: "POST /fx/orders/shop1/lines" }), tab.shows(/1 of 5/), tab.visible({ role: "button", name: "Previous" }), check("the URL names the record", /record=/.test(tab.page.url()), tab.page.url())]);
      await tab.click({ role: "tab", name: "Request" });
      await ctx.verify("Request", [tab.shows(/QUERY\s+limit\s+5/), tab.shows(/HEADERS\s+host\s+\S+\s+content-type\s+application\/json/), tab.shows(/Only allow-listed headers are captured\./), tab.shows(/BODY[\s\S]*sku[\s\S]*"A1"/)]);
      await tab.click({ role: "tab", name: "Response" });
      await ctx.verify("Response", [tab.shows(/201 Created/), tab.shows(new RegExp(`HEADERS\\s+content-type\\s+application/json\\s+content-length\\s+${answerLength}`)), tab.shows(/BODY[\s\S]*shop[\s\S]*"shop1"[\s\S]*limit[\s\S]*"5"/)]);
      await tab.click({ role: "link", name: "Replay in tester" });
      await ctx.verify("Replay in tester", [
        check("the Tester of the route opens", /tab=tester/.test(tab.page.url()) && /route=POST/.test(tab.page.url()), tab.page.url()),
        tab.shows(/Replayed from [0-9a-f-]{8}[0-9a-f-]* \(\d\d:\d\d:\d\d\)/),
        tab.shows(/Not restored: host, user-agent, accept-encoding, content-length\. Authorization, Cookie and X-Api-Key are never captured\./),
        tab.shows(/\?limit=5/),
        tab.shows(/"sku": "A1",\s+"quantity": 2/),
      ]);
      await openPage(tab, "/modules/api/logs");
      await tab.click({ role: "button", name: "Open request", nth: 0 });
      await tab.click({ role: "button", name: "Next" });
      await ctx.verify("Next", [tab.visible({ role: "dialog", name: "GET /fx/boom" }), tab.shows(/2 of 5/)]);
      await tab.press("j");
      await ctx.verify("J steps to the next request (the drawer's own hint: J next, K previous)", [tab.shows(/3 of 5/), tab.visible({ role: "dialog", name: "GET /fx/boom" })]);
      await tab.press("k");
      await ctx.verify("K steps back", [tab.shows(/2 of 5/)]);
      const url = tab.page.url();
      await tab.reload();
      await ctx.verify("a reload", [tab.visible({ role: "dialog", name: "GET /fx/boom" }), check("the same record", tab.page.url() === url, tab.page.url())]);
      await ctx.verify("Summary", [tab.shows(/fixture boom: the invoice has no customer/), tab.shows(/Route\s+GET \/fx\/boom/), tab.shows(/User agent\s+\S+/), tab.shows(/Request ID\s+[0-9a-f-]{36}/), tab.shows(/500 Internal Server Error/), tab.shows(/TIMING/)]);
      await tab.click({ role: "link", name: "Same error" });
      await ctx.verify("Same error", [check("the URL names the route and the error", /route=GET\+%2Ffx%2Fboom/.test(tab.page.url()) && /error=fixture\+boom/.test(tab.page.url()), tab.page.url()), tab.visible({ role: "button", name: "All 2" }), tab.shows(/\/fx\/ok/, { not: true, timeoutMs: 3000 })]);
    },
  },
  {
    id: "a-link-names-a-range-with-since-and-until",
    title: "/modules/api/logs?since=&until= lists only the requests of that range, never more than the period, and the tabs count only them",
    entryPoint: "/modules/api/logs?since=<iso>&until=<iso>",
    async run(/** @type {Ctx} */ ctx) {
      await seedLogs(ctx, "3 requests 5 hours ago", { minutesAgo: 300, count: 3, uri: "/fx/ok" });
      await seedLogs(ctx, "2 failing requests 2 hours ago", { minutesAgo: 120, count: 2, uri: "/fx/boom", statusCode: 500, message: "seeded failure" });
      const since = new Date(Date.now() - 6 * 3_600_000).toISOString();
      const until = new Date(Date.now() - 3 * 3_600_000).toISOString();
      const inRange = await mon(ctx, "the range", `/logs?preset=last-24h&filter_since=is:${encodeURIComponent(since)}&filter_until=is:${encodeURIComponent(until)}`);
      await ctx.verify("the API", [
        same("only the three requests of the range", [num(inRange.body, "total"), [...new Set(list(inRange.body, "results").map((row) => text(row, "path")))]], [3, ["/fx/ok"]]),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, `/modules/api/logs?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`);
      await ctx.verify("the page", [
        tab.visible({ role: "button", name: "All 3" }),
        tab.visible({ role: "button", name: "5xx 0" }),
        tab.shows(/seeded failure/, { not: true, timeoutMs: 2000 }),
      ]);
      await openPage(tab, "/modules/api/logs");
      await ctx.verify("without the range", [tab.visible({ role: "button", name: "All 5" }), tab.visible({ role: "button", name: "5xx 2" })]);
    },
  },
]);
