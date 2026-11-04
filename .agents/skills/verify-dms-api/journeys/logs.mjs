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
          check(`${startDays} to ${endDays} days ago: at least 50 bars`, bars >= 50, bars),
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
      await ctx.verify("the Summary facts of the newest request", [
        tab.shows(new RegExp(`URL\\s+${ctx.state.webUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/fx/orders/shop1/lines\\?limit=5`)),
        tab.shows(/Date\s+\w{3}, \d{1,2} \w{3} \d{4}, \d\d:\d\d:\d\d\.\d{3}/),
        tab.shows(/Route\s+POST \/fx\/orders\/:shop\/lines/),
        tab.shows(/Client IP\s+(::ffff:)?127\.0\.0\.1/),
        tab.shows(/User agent\s+\S+/),
        tab.shows(/Request ID\s+[0-9a-f-]{36}/),
        tab.shows(/PATH PARAMETERS\s+shop\s+shop1/),
        tab.shows(/201 Created/),
      ]);
      await tab.click({ role: "tab", name: "Request" });
      await ctx.verify("Request", [tab.shows(/QUERY\s+limit\s+5/), tab.shows(/HEADERS\s+host\s+\S+\s+content-type\s+application\/json/), tab.shows(/Only allow-listed headers are captured\./), tab.shows(/BODY[\s\S]*sku[\s\S]*"A1"/), tab.shows(/JSON · 25 B/)]);
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
      await seedLogs(ctx, "2 requests 8 hours ago", { minutesAgo: 480, count: 2, uri: "/fx/ok" });
      await seedLogs(ctx, "3 requests 5 hours ago", { minutesAgo: 300, count: 3, uri: "/fx/ok" });
      await seedLogs(ctx, "2 failing requests 2 hours ago", { minutesAgo: 120, count: 2, uri: "/fx/boom", statusCode: 500, message: "seeded failure" });
      const since = new Date(Date.now() - 6 * 3_600_000).toISOString();
      const until = new Date(Date.now() - 3 * 3_600_000).toISOString();
      const inRange = await mon(ctx, "the range", `/logs?preset=last-24h&filter_since=is:${encodeURIComponent(since)}&filter_until=is:${encodeURIComponent(until)}`);
      await ctx.verify("the API", [
        same("only the three requests of the range, not the two before it nor the two after", [num(inRange.body, "total"), [...new Set(list(inRange.body, "results").map((row) => text(row, "path")))]], [3, ["/fx/ok"]]),
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
      await ctx.verify("without the range", [tab.visible({ role: "button", name: "All 7" }), tab.visible({ role: "button", name: "5xx 2" })]);
    },
  },
  {
    id: "a-past-range-draws-at-most-120-bars",
    title: "the chart keeps between 50 and 120 bars for a past range: the 6-to-1-day and 20-to-10-day ranges draw 121 (dms-api issue: the closing bar of an unaligned range)",
    entryPoint: "GET /api/monitoring/logs/live?from=&to=",
    async run(/** @type {Ctx} */ ctx) {
      /** @type {[number, number][]} */
      const ranges = [[3, 2], [6, 1], [20, 10], [50, 2], [0.1, 0.05]];
      const answers = [];
      for (const [startDays, endDays] of ranges) {
        const from = new Date(Date.now() - startDays * 86_400_000).toISOString();
        const to = new Date(Date.now() - endDays * 86_400_000).toISOString();
        answers.push(await mon(ctx, `a past range from ${startDays} to ${endDays} days ago`, `/logs/live?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));
      }
      await ctx.verify("the bar count the docs promise", answers.map((answer, index) => {
        const bars = list(answer.body, "buckets").length;
        return check(`${ranges[index]?.join(" to ")} days ago: 50 to 120 bars`, bars >= 50 && bars <= 120, bars);
      }));
    },
  },
  {
    id: "filters-combine-with-the-status-tab",
    title: "a status tab, the Method filter, Slow and a route narrow the list together, each by its own rule",
    entryPoint: "GET /api/monitoring/logs?filter_statusClass=&filter_method=&filter_slow=&filter_route=",
    async run(/** @type {Ctx} */ ctx) {
      await saveSettings(ctx, "slow from 50 ms", { requestSlownessThresholdMs: 50 });
      await traffic(ctx, "eight calls", [
        { path: "/fx/ok", count: 3 }, { path: "/fx/slow?ms=80", count: 1 }, { path: "/fx/echo", count: 2, method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
        { path: "/fx/boom", count: 1 }, { path: "/fx/missing", count: 1 },
      ]);
      await settled(ctx, "the logs hold 8", "/logs?preset=last-24h", (body) => num(body, "total") === 8);
      const cases = [
        ["2xx and POST", "filter_statusClass=is:2xx&filter_method=is:POST", 2, ["/fx/echo"]],
        ["2xx and GET", "filter_statusClass=is:2xx&filter_method=is:GET", 4, ["/fx/ok", "/fx/slow"]],
        ["4xx and GET", "filter_statusClass=is:4xx&filter_method=is:GET", 1, ["/fx/missing"]],
        ["4xx and POST", "filter_statusClass=is:4xx&filter_method=is:POST", 0, []],
        ["5xx and slow", "filter_statusClass=is:5xx&filter_slow=is:true", 0, []],
        ["2xx and slow", "filter_statusClass=is:2xx&filter_slow=is:true", 1, ["/fx/slow"]],
        ["slow and POST", "filter_slow=is:true&filter_method=is:POST", 0, []],
        ["2xx and a route", `filter_statusClass=is:2xx&filter_route=is:${encodeURIComponent("POST /fx/echo")}`, 2, ["/fx/echo"]],
        ["a route under another tab", `filter_statusClass=is:5xx&filter_route=is:${encodeURIComponent("POST /fx/echo")}`, 0, []],
      ];
      const results = [];
      for (const [label, query, total, paths] of cases) {
        const got = await listed(ctx, String(label), String(query));
        results.push(same(String(label), [got.total, [...new Set(got.paths)].toSorted((left, right) => left.localeCompare(right))], [total, paths]));
      }
      await ctx.verify("combined filters", results);
    },
  },
  {
    id: "the-list-sorts-by-duration-both-ways",
    title: "sorting by duration puts the shortest request first ascending and the longest first descending, and the table writes durations as less than 1 ms, whole milliseconds and grouped thousands",
    entryPoint: "GET /api/monitoring/logs?sortKey=responseTimeMs&sortDirection=",
    async run(/** @type {Ctx} */ ctx) {
      await seedLogs(ctx, "0.4 ms", { minutesAgo: 10, count: 1, uri: "/fx/ok", responseTimeMs: 0.4 });
      await seedLogs(ctx, "12 ms", { minutesAgo: 9, count: 1, uri: "/fx/blob", responseTimeMs: 12 });
      await seedLogs(ctx, "999 ms", { minutesAgo: 8, count: 1, uri: "/fx/missing", responseTimeMs: 999 });
      await seedLogs(ctx, "1234.5 ms", { minutesAgo: 7, count: 1, uri: "/fx/boom", responseTimeMs: 1234.5 });
      const ascending = await mon(ctx, "ascending", "/logs?preset=last-24h&sortKey=responseTimeMs&sortDirection=asc");
      const descending = await mon(ctx, "descending", "/logs?preset=last-24h&sortKey=responseTimeMs&sortDirection=desc");
      const order = (/** @type {import("../api.mjs").Answer} */ answer) => list(answer.body, "results").map((row) => text(row, "path"));
      await ctx.verify("the order", [
        same("ascending", order(ascending), ["/fx/ok", "/fx/blob", "/fx/missing", "/fx/boom"]),
        same("descending", order(descending), ["/fx/boom", "/fx/missing", "/fx/blob", "/fx/ok"]),
        same("the slow flag follows the 1 s default", list(ascending.body, "results").map((row) => pick(row, "slow")), [false, false, false, true]),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/logs");
      await ctx.verify("the table", [
        tab.shows(/\b0 ms\s+GET\s+\/fx\/ok/),
        tab.shows(/12 ms\s+GET\s+\/fx\/blob/),
        tab.shows(/999 ms\s+GET\s+\/fx\/missing/),
        tab.shows(/1,235 ms\s+GET\s+\/fx\/boom|1,234 ms\s+GET\s+\/fx\/boom/),
      ]);
    },
  },
  {
    id: "the-slow-labels-follow-the-threshold-in-seconds-or-milliseconds",
    title: "the Slow filter and the Overview's slow line name the threshold: 1 s by default, 1.05 s, 2 s, 950 ms, 50 ms and 600 s as it is set",
    entryPoint: "/modules/api/logs and /modules/api/overview",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/logs");
      await ctx.verify("the default", [tab.visible({ role: "button", name: "Slow (≥ 1 s)" })]);
      /** @type {[number, string][]} */
      const labels = [[1050, "1.05 s"], [2000, "2 s"], [950, "950 ms"], [50, "50 ms"], [600000, "600 s"]];
      for (const [threshold, label] of labels) {
        await saveSettings(ctx, `slow from ${threshold} ms`, { requestSlownessThresholdMs: threshold });
        await openPage(tab, "/modules/api/logs");
        await ctx.verify(`${threshold} ms`, [tab.visible({ role: "button", name: `Slow (≥ ${label})` })]);
      }
      await saveSettings(ctx, "back to the default", { requestSlownessThresholdMs: null });
      await traffic(ctx, "twenty slow calls", [{ path: "/fx/slow?ms=1100", count: 20 }]);
      await settled(ctx, "counted", "/overview/attention", (body) => list(body, "items").length === 1);
      await openPage(tab, "/modules/api/overview");
      await ctx.verify("the Overview", [tab.shows(/1 slow route\s+\(≥\s*1\s*s\)/)]);
    },
  },
  {
    id: "counts-are-grouped-and-all-time-compares-nothing",
    title: "1,234 requests read All 1,234, 1 of 1,234 in the drawer and 1,234 requests above the chart; the All time period offers no comparison and the Overview and Routes controls do",
    entryPoint: "/modules/api/logs?api.period=all",
    async run(/** @type {Ctx} */ ctx) {
      await seedLogs(ctx, "1234 requests", { minutesAgo: 30, count: 1234, uri: "/fx/ok" });
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/logs?api.period=all");
      await ctx.verify("All time", [
        tab.visible({ role: "button", name: "All 1,234" }),
        tab.visible({ role: "button", name: "2xx 1,234" }),
        tab.shows(/1,234 requests/),
        isOn(tab, { role: "radio", name: "All time" }),
        tab.visible({ role: "button", name: /^Comparison:/ }, { hidden: true, timeoutMs: 3000 }),
        tab.shows(/vs previous period|previous period/i, { not: true, timeoutMs: 2000 }),
      ]);
      await tab.click({ role: "button", name: "Open request", nth: 0 });
      await ctx.verify("the drawer", [tab.shows(/1 of 1,234/)]);
      await openPage(tab, "/modules/api/logs?api.period=last-24h");
      await ctx.verify("a rolling period", [tab.visible({ role: "button", name: "All 1,234" })]);
    },
  },
]);
