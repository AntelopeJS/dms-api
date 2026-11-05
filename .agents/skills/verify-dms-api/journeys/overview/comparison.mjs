import { seedLogs } from "../../seed.mjs";
import { check, list, mon, num, pick, same, saveSettings, settled, text, traffic, openPage } from "../../api.mjs";
import { named } from "./shared.mjs";

/** @typedef {import("../../api.mjs").Ctx} Ctx */

/** The overview journeys about comparison. */
export const comparison = [
  {
    id: "a-route-is-flagged-at-the-documented-edges-whatever-the-period",
    title: "19 calls that all fail with a 4xx are too few, 20 calls with 1 client error (5%) are flagged, 25 calls with 1 (4%) are not, 19 slow calls are too few; a route flagged over the last 24 hours stays listed on the 1H period; the hero shows its four signals",
    entryPoint: "GET /api/monitoring/overview/attention and /modules/api/overview",
    async run(/** @type {Ctx} */ ctx) {
      await saveSettings(ctx, "slow from 50 ms", { requestSlownessThresholdMs: 50 });
      await seedLogs(ctx, "20 client errors 3 hours ago", { minutesAgo: 180, count: 20, uri: "/fx/blob", statusCode: 404, message: "seeded" });
      await traffic(ctx, "the edges", [
        { path: "/fx/missing", count: 19 },
        { path: "/fx/items/7", count: 19 },
        { path: "/fx/items/x1", count: 1 },
        { path: "/fx/guarded/secret", count: 24, headers: { authorization: "Bearer letmein" } },
        { path: "/fx/guarded/secret", count: 1 },
        { path: "/fx/slow?ms=80", count: 19 },
      ]);
      const attention = await settled(ctx, "attention", "/overview/attention", (body) => list(body, "items").length >= 2);
      const hour = await settled(ctx, "traffic over the last hour", "/overview/traffic?preset=last-hour", (body) => num(body, "value") === 83);
      const day = await mon(ctx, "traffic over the last 24 hours", "/overview/traffic?preset=last-24h");
      const flagged = list(attention.body, "items").map((item) => [text(item, "route"), text(item, "state")]).toSorted((left, right) => String(left[0]).localeCompare(String(right[0])));
      await ctx.verify("the edges", [
        same("only the routes at or past an edge are flagged", flagged, [["GET /fx/blob", "client-errors"], ["GET /fx/items/:id", "client-errors"]]),
        same("the 20 calls with one client error read 5%", num(list(attention.body, "items").find((item) => text(item, "route") === "GET /fx/items/:id"), "metrics", "clientErrorRate"), 5),
        same("the last hour holds the 83 calls, the last 24 hours the 20 seeded ones too", [num(hour.body, "value"), num(day.body, "value")], [83, 103]),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/overview?api.period=last-hour");
      await ctx.verify("the last hour", [
        tab.shows(/Needs attention\s+2/i),
        tab.shows(/GET \/fx\/blob\s+4xx rate · 100% client errors · 20 of 20 calls/i),
        tab.shows(/GET \/fx\/items\/:id\s+4xx rate · 5% client errors · 1 of 20 calls/i),
        tab.shows(/5xx · 15 min\s+0%/i),
        tab.shows(/4xx · 15 min\s+25\.3%/i),
        tab.shows(/Traffic · 15 min\s+5\.5 req\/min/i),
        tab.shows(/p95 latency · 15 min\s+\d+ ms\s+Slow from 50 ms/i),
        tab.shows(/\d+ routes in scope/i),
      ]);
    },
  },
  {
    id: "a-comparison-beyond-the-kept-statistics-compares-with-nothing",
    title: "with the statistics kept 30 days the 30D period has no previous period (nothing is drawn, no zeros) and Routes says so; kept 60 days it has one; the 7D period keeps its comparison either way",
    entryPoint: "GET /api/monitoring/overview/traffic?comparison=previous-period",
    async run(/** @type {Ctx} */ ctx) {
      await traffic(ctx, "some calls", [{ path: "/fx/ok", count: 3 }]);
      const windowOf = async (/** @type {string} */ label, /** @type {string} */ preset) => {
        const answer = await settled(ctx, label, `/overview/traffic?preset=${preset}&comparison=previous-period`, (body) => num(body, "value") === 3);
        return [pick(answer.body, "window", "previousAvailable"), pick(answer.body, "window", "comparison"), list(answer.body, "series").length];
      };
      const kept90 = await windowOf("30D kept 90 days", "last-30-days");
      await saveSettings(ctx, "keep 60 days", { statisticsLifetimeDays: 60 });
      const kept60 = await windowOf("30D kept 60 days", "last-30-days");
      await saveSettings(ctx, "keep 30 days", { statisticsLifetimeDays: 30 });
      const kept30 = await windowOf("30D kept 30 days", "last-30-days");
      const week30 = await windowOf("7D kept 30 days", "last-7-days");
      await ctx.verify("the API", [
        same("kept 90 days: the 30D period has a previous period", kept90[0], true),
        same("kept 60 days: the 30D period has a previous period", kept60[0], true),
        same("kept 30 days: the 30D period has none", kept30[0], false),
        same("kept 30 days: the 7D period still has one", week30[0], true),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, `/modules/api/routes?${named("GET /fx/ok")}&api.period=last-30-days&api.compare=previous-period`);
      await ctx.verify("Routes at 30 days", [tab.shows(/REQUESTS\s+3\s+No previous period/)]);
      await openPage(tab, `/modules/api/routes?${named("GET /fx/ok")}&api.period=last-7-days&api.compare=previous-period`);
      await ctx.verify("Routes at 7 days", [tab.shows(/REQUESTS\s+3\s+none over the previous period/)]);
      await saveSettings(ctx, "keep 90 days again", { statisticsLifetimeDays: 90 });
      await openPage(tab, `/modules/api/routes?${named("GET /fx/ok")}&api.period=last-30-days&api.compare=previous-period`);
      await ctx.verify("Routes at 30 days kept 90", [tab.shows(/REQUESTS\s+3\s+none over the previous period/)]);
    },
  },
  {
    id: "the-hero-says-how-long-the-verdict-has-held-and-when-it-was-checked",
    title: "10 failing calls out of 20 three minutes ago read Down for 3 min with the tooltip Down since the minute the incident started, and the hero says when it was checked",
    entryPoint: "/modules/api/overview",
    async run(/** @type {Ctx} */ ctx) {
      await seedLogs(ctx, "100 good calls 10 minutes ago", { minutesAgo: 10, count: 100 });
      await seedLogs(ctx, "10 good calls 3 minutes ago", { minutesAgo: 3, count: 10 });
      await seedLogs(ctx, "10 failing calls 3 minutes ago", { minutesAgo: 3, count: 10, uri: "/fx/boom", statusCode: 500, message: "seeded" });
      const health = await settled(ctx, "health", "/overview/health", (body) => text(body, "verdict") === "down");
      const started = Date.parse(text(health.body, "incidentStart"));
      const checked = Date.parse(text(health.body, "checkedAt"));
      await ctx.verify("the API", [
        same("the verdict", text(health.body, "verdict"), "down"),
        check("it has held for about 3 minutes", (num(health.body, "durationMs") ?? 0) > 150_000 && (num(health.body, "durationMs") ?? 0) < 240_000, num(health.body, "durationMs")),
        check("the incident started about 3 minutes ago", Math.abs(checked - started - 180_000) < 60_000, [text(health.body, "incidentStart"), text(health.body, "checkedAt")]),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/overview");
      await ctx.verify("the hero", [
        tab.shows(/API health · live\s+Down/i),
        tab.shows(/for 3 min\s*·\s*checked \d\d:\d\d:\d\d/),
        check("the tooltip names the minute the verdict began", /^Down since \w+ \d{1,2} \w+ \d{4} at \d\d:\d\d$/.test((await tab.page.locator("time").first().getAttribute("title")) ?? ""), await tab.page.locator("time").first().getAttribute("title")),
        check("the tooltip's minute is the verdict's start, about 3 minutes ago", await (async () => {
          const since = (await tab.page.locator("time").first().getAttribute("datetime")) ?? "";
          const title = (await tab.page.locator("time").first().getAttribute("title")) ?? "";
          return title.endsWith(`at ${since.slice(11, 16)}`) && Math.abs(Date.now() - Date.parse(since) - 180_000) < 90_000;
        })(), "tooltip"),
        check("checked is a clock of the last two minutes", await (async () => {
          const shown = /checked (\d\d):(\d\d):(\d\d)/.exec(await tab.page.locator("body").innerText());
          if (!shown) return false;
          const now = new Date();
          const at = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Number(shown[1]), Number(shown[2]), Number(shown[3]));
          return Math.abs(Date.now() - at) < 120_000;
        })(), "checked"),
      ]);
    },
  },
  {
    id: "a-comparison-the-page-does-not-know-compares-with-nothing",
    title: "a year back or any name the page does not know gives no previous period, no compared line and no previous-period figure, where the two names it knows do",
    entryPoint: "GET /api/monitoring/overview/traffic?comparison=",
    async run(/** @type {Ctx} */ ctx) {
      await traffic(ctx, "some calls", [{ path: "/fx/ok", count: 3 }]);
      await settled(ctx, "counted", "/overview/traffic?preset=last-24h", (body) => num(body, "value") === 3);
      const windowOf = async (/** @type {string} */ name) => {
        const answer = await mon(ctx, `comparison ${name}`, `/overview/traffic?preset=last-24h&comparison=${name}`);
        return [pick(answer.body, "window", "comparison"), pick(answer.body, "window", "previous") === null, pick(answer.body, "window", "previousAvailable"), list(answer.body, "series").length];
      };
      await ctx.verify("the names", [
        same("previous-year", await windowOf("previous-year"), ["none", true, false, 3]),
        same("year", await windowOf("year"), ["none", true, false, 3]),
        same("an empty name", await windowOf(""), ["none", true, false, 3]),
        same("none", await windowOf("none"), ["none", true, false, 3]),
        same("previous-period", await windowOf("previous-period"), ["previous-period", false, true, 3]),
      ]);
    },
  },
  {
    id: "every-figure-compared-with-the-period-before-says-its-change-and-its-value",
    title: "with 12 calls in the period before and 14 now, Traffic reads +16.7% vs 12, Error share 14.3% vs 0.0%, the slowest route's average is compared with the average before (100 ms against 50), and the status classes against theirs",
    entryPoint: "/modules/api/overview",
    async run(/** @type {Ctx} */ ctx) {
      await seedLogs(ctx, "10 calls 30 hours ago", { minutesAgo: 1800, count: 10, uri: "/fx/ok", responseTimeMs: 5 });
      await seedLogs(ctx, "a fast slow call 30 hours ago", { minutesAgo: 1800, count: 1, uri: "/fx/slow", responseTimeMs: 10 });
      await seedLogs(ctx, "a slower slow call 30 hours ago", { minutesAgo: 1800, count: 1, uri: "/fx/slow", responseTimeMs: 90 });
      await seedLogs(ctx, "10 calls now", { minutesAgo: 20, count: 10, uri: "/fx/ok", responseTimeMs: 5 });
      await seedLogs(ctx, "2 slow calls now", { minutesAgo: 20, count: 2, uri: "/fx/slow", responseTimeMs: 100 });
      await seedLogs(ctx, "2 client errors now", { minutesAgo: 20, count: 2, uri: "/fx/missing", statusCode: 404, message: "seeded", responseTimeMs: 5 });
      await settled(ctx, "traffic", "/overview/traffic?preset=last-24h&comparison=previous-period", (body) => num(body, "value") === 14);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/overview");
      await ctx.verify("Traffic and Error share", [
        tab.shows(/TRAFFIC & ERRORS\s+14\s+\+16\.7%\s+vs 12/i),
        tab.shows(/ERROR SHARE\s+14\.3%\s+vs 0\.0%/i),
      ]);
      await ctx.verify("Slowest routes", [
        tab.shows(/GET \/fx\/slow\s+p95 \d+ ms · max 100 ms · 2 calls · \+100% vs\. 50 ms previous period/),
        tab.shows(/GET \/fx\/ok\s+p95 5 ms · max 5 ms · 10 calls · \+0% vs\. 5 ms previous period/),
        tab.shows(/GET \/fx\/missing\s+p95 5 ms · max 5 ms · 2 calls · none over the previous period/),
      ]);
      await ctx.verify("Responses by class", [
        tab.shows(/85\.7% of calls · \+0% vs\. 12 previous period/),
        tab.shows(/14\.3% of calls · none over the previous period/),
        tab.shows(/0% of calls · \+0% vs\. 0 previous period/),
      ]);
    },
  },
  {
    id: "the-slowest-routes-are-ranked-by-average-latency-not-by-their-slowest-call",
    title: "a route averaging 100 ms ranks above one that averages 99 ms but had a 900 ms call, in the API and on the page",
    entryPoint: "GET /api/monitoring/overview/slowest",
    async run(/** @type {Ctx} */ ctx) {
      await seedLogs(ctx, "four calls at 100 ms", { minutesAgo: 30, count: 4, uri: "/fx/slow", responseTimeMs: 100 });
      await seedLogs(ctx, "nine calls at 10 ms", { minutesAgo: 30, count: 9, uri: "/fx/ok", responseTimeMs: 10 });
      await seedLogs(ctx, "one call at 900 ms", { minutesAgo: 30, count: 1, uri: "/fx/ok", responseTimeMs: 900 });
      const slowest = await settled(ctx, "slowest", "/overview/slowest", (body) => list(body, "items").length === 2);
      await ctx.verify("the ranking", [
        same("by average latency", list(slowest.body, "items").map((item) => text(item, "id")), ["GET /fx/slow", "GET /fx/ok"]),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/overview");
      await ctx.verify("the page", [
        tab.shows(/GET \/fx\/slow\s+p95 \d+ ms · max 100 ms · 4 calls[\s\S]*GET \/fx\/ok\s+p95 \d+ ms · max 900 ms · 10 calls/),
      ]);
    },
  },
];
