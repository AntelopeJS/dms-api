import { check, list, mon, num, pick, raw, same, settled, text, traffic, openPage } from "../../api.mjs";
import { seedLogs } from "../../seed.mjs";

/** @typedef {import("../../api.mjs").Ctx} Ctx */

/** The logs journeys about histogram and drawer. */
export const histogramAndDrawer = [
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
      await traffic(ctx, "five calls", [{ path: "/fx/ok", count: 1 }, { path: "/fx/items/7", count: 1 }, { path: "/fx/boom", count: 2 }, { path: "/fx/boom-twin", count: 1 }]);
      await raw(ctx, "a call with a body", { method: "POST", path: "/fx/orders/shop1/lines?limit=5", headers: { "content-type": "application/json" }, body: JSON.stringify({ sku: "A1", quantity: 2 }) });
      await settled(ctx, "the logs", "/logs", (body) => num(body, "total") === 6);
      const answerLength = Buffer.byteLength(JSON.stringify({ shop: "shop1", limit: "5", line: { sku: "A1", quantity: 2 } }));
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/logs");
      await tab.click({ role: "button", name: "Open request", nth: 0 });
      await ctx.verify("the newest request", [tab.visible({ role: "dialog", name: "POST /fx/orders/shop1/lines" }), tab.shows(/1 of 6/), tab.visible({ role: "button", name: "Previous" }), check("the URL names the record", /record=/.test(tab.page.url()), tab.page.url())]);
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
      await ctx.verify("Next", [tab.visible({ role: "dialog", name: "GET /fx/boom-twin" }), tab.shows(/2 of 6/)]);
      await tab.press("j");
      await ctx.verify("J steps to the next request (the drawer's own hint: J next, K previous)", [tab.shows(/3 of 6/), tab.visible({ role: "dialog", name: /^GET \/fx\/boom$/ })]);
      await tab.press("k");
      await ctx.verify("K steps back", [tab.shows(/2 of 6/)]);
      const url = tab.page.url();
      await tab.reload();
      await ctx.verify("a reload", [tab.visible({ role: "dialog", name: "GET /fx/boom-twin" }), tab.shows(/2 of 6/), check("the same record", tab.page.url() === url, tab.page.url())]);
      await tab.press("j");
      await ctx.verify("the next one is the other route's twin neighbour", [tab.visible({ role: "dialog", name: /^GET \/fx\/boom$/ }), tab.shows(/3 of 6/)]);
      await ctx.verify("Summary", [tab.shows(/fixture boom: the invoice has no customer/), tab.shows(/Route\s+GET \/fx\/boom/), tab.shows(/User agent\s+\S+/), tab.shows(/Request ID\s+[0-9a-f-]{36}/), tab.shows(/500 Internal Server Error/), tab.shows(/TIMING/)]);
      await tab.click({ role: "link", name: "Same error" });
      await ctx.verify("Same error", [check("the URL names the route and the error", /route=GET\+%2Ffx%2Fboom/.test(tab.page.url()) && /error=fixture\+boom/.test(tab.page.url()), tab.page.url()), tab.visible({ role: "button", name: "All 2" }), tab.shows(/\/fx\/ok|boom-twin/, { not: true, timeoutMs: 3000 })]);
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
];
