import { guarded } from "../guard.mjs";
import { seedLogs } from "../seed.mjs";
import { check, isOn, list, mon, num, pick, same, saveSettings, settled, text, traffic, openPage } from "../api.mjs";

/**
 * @param {string} ref A route reference
 * @returns {string} The query that names it
 */
const named = (ref) => `route=${encodeURIComponent(ref)}`;

/** @typedef {import("../api.mjs").Ctx} Ctx */

/**
 * Sends `good` fast calls and `bad` failing calls, waits until the console has counted them, and reads the verdict
 * through the API and the Overview's hero.
 *
 * @param {Ctx} ctx The journey
 * @param {{ good: number, bad: number, verdict: string, label: string, rate: number }} plan What to send and what must be read
 */
async function verdictOf(ctx, plan) {
  await traffic(ctx, `${plan.good} good and ${plan.bad} failing`, [{ path: "/fx/ok", count: plan.good }, { path: "/fx/boom", count: plan.bad }]);
  const total = plan.good + plan.bad;
  const health = await settled(ctx, "health", "/overview/health", (body) => num(body, "metrics", "requests") === total || (total === 0 && true));
  await ctx.verify("the API's verdict", [
    same("the verdict", text(health.body, "verdict"), plan.verdict),
    same("requests counted over the window", num(health.body, "metrics", "requests"), total),
    check("the 5xx rate", Math.abs((num(health.body, "metrics", "serverErrorRate") ?? -1) - plan.rate) < 0.01, num(health.body, "metrics", "serverErrorRate")),
  ]);
  const tab = await ctx.tab("admin");
  await tab.signIn("admin");
  await openPage(tab, "/modules/api/overview");
  await ctx.verify("the hero", [tab.visible({ role: "region", name: "API health" }), tab.shows(new RegExp(`API health · live\\s+${plan.label}\\s`, "i"))]);
  return tab;
}

export const journeys = guarded([
  {
    id: "with-no-traffic-the-verdict-is-idle",
    title: "before any call, the API health reads No traffic with zero requests",
    entryPoint: "/modules/api/overview",
    async run(/** @type {Ctx} */ ctx) {
      await verdictOf(ctx, { good: 0, bad: 0, verdict: "idle", label: "No traffic", rate: 0 });
    },
  },
  {
    id: "nineteen-failing-calls-are-too-few-to-judge",
    title: "19 calls that all fail are not an outage: a rate is only read over 20 calls or more",
    entryPoint: "/modules/api/overview",
    async run(/** @type {Ctx} */ ctx) {
      await verdictOf(ctx, { good: 0, bad: 19, verdict: "operational", label: "Healthy", rate: 100 });
    },
  },
  {
    id: "one-failing-call-in-a-hundred-is-degraded",
    title: "99 good calls and 1 failing call (exactly 1%) read Degraded; the hero shows the 15-minute 5xx rate",
    entryPoint: "/modules/api/overview",
    async run(/** @type {Ctx} */ ctx) {
      await verdictOf(ctx, { good: 99, bad: 1, verdict: "degraded", label: "Degraded", rate: 1 });
    },
  },
  {
    id: "one-failing-call-in-a-hundred-and-one-is-operational",
    title: "100 good calls and 1 failing call (0.99%) read Healthy",
    entryPoint: "/modules/api/overview",
    async run(/** @type {Ctx} */ ctx) {
      await verdictOf(ctx, { good: 100, bad: 1, verdict: "operational", label: "Healthy", rate: 100 / 101 });
    },
  },
  {
    id: "a-fifth-of-the-calls-failing-is-down",
    title: "80 good calls and 20 failing calls (exactly 20% over 5 minutes) read Down",
    entryPoint: "/modules/api/overview",
    async run(/** @type {Ctx} */ ctx) {
      await verdictOf(ctx, { good: 80, bad: 20, verdict: "down", label: "Down", rate: 20 });
    },
  },
  {
    id: "nineteen-percent-failing-is-degraded-not-down",
    title: "81 good calls and 19 failing calls (19%) read Degraded, not Down",
    entryPoint: "/modules/api/overview",
    async run(/** @type {Ctx} */ ctx) {
      await verdictOf(ctx, { good: 81, bad: 19, verdict: "degraded", label: "Degraded", rate: 19 });
    },
  },
  {
    id: "the-blocks-rank-the-routes-by-what-is-wrong-with-them",
    title: "Needs attention lists a failing, a slow and a noisy route with their facts, Slowest routes ranks by average latency, and the share, traffic and class blocks add up",
    entryPoint: "/modules/api/overview",
    async run(/** @type {Ctx} */ ctx) {
      await saveSettings(ctx, "slow from 50 ms", { requestSlownessThresholdMs: 50 });
      await traffic(ctx, "four routes", [{ path: "/fx/boom", count: 25 }, { path: "/fx/missing", count: 25 }, { path: "/fx/slow?ms=80", count: 25 }, { path: "/fx/ok", count: 30 }]);
      const classes = await settled(ctx, "classes", "/overview/classes", (body) => list(body, "items").reduce((sum, item) => sum + (num(item, "value") ?? 0), 0) === 105);
      const attention = await mon(ctx, "attention", "/overview/attention");
      const slowest = await mon(ctx, "slowest", "/overview/slowest");
      const share = await mon(ctx, "error share", "/overview/error-share");
      const trafficBlock = await mon(ctx, "traffic", "/overview/traffic");
      const items = list(attention.body, "items");
      await ctx.verify("the API", [
        same("attention rows and states, most urgent first", items.map((item) => [text(item, "route"), text(item, "state")]), [["GET /fx/boom", "failing"], ["GET /fx/slow", "slow"], ["GET /fx/missing", "client-errors"]]),
        same("the failing route's facts", [num(items[0], "metrics", "calls"), num(items[0], "metrics", "serverErrors"), text(items[0], "topError", "message"), num(items[0], "topError", "count")], [25, 25, "fixture boom: the invoice has no customer", 25]),
        check("the slow route's p95 and average are the 80 ms the handler waits", [num(items[1], "metrics", "p95Ms"), num(items[1], "metrics", "averageMs")].every((value) => value !== undefined && value >= 80 && value <= 95), [num(items[1], "metrics", "p95Ms"), num(items[1], "metrics", "averageMs")]),
        same("the noisy route's client error rate", num(items[2], "metrics", "clientErrorRate"), 100),
        same("the status classes (2xx, 4xx, 5xx)", list(classes.body, "items").map((item) => [text(item, "statusClass"), num(item, "value"), num(item, "share")]), [["2xx", 55, 52.4], ["4xx", 25, 23.8], ["5xx", 25, 23.8]]),
        check("the error share is 50 of 105 calls", Math.abs((num(share.body, "value") ?? -1) - 47.6) < 0.1 || Math.abs((num(share.body, "value") ?? -1) - 0.476) < 0.001, num(share.body, "value")),
        same("the traffic block counts 105 calls", num(trafficBlock.body, "value"), 105),
        same("slowest routes start with the slowest", text(list(slowest.body, "items")[0], "id"), "GET /fx/slow"),
        same("slowest routes list the four routes", list(slowest.body, "items").map((item) => text(item, "id")).sort(), ["GET /fx/boom", "GET /fx/missing", "GET /fx/ok", "GET /fx/slow"]),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/overview");
      await ctx.verify("the page", [
        tab.shows(/Needs attention\s+3/i),
        tab.shows(/GET \/fx\/boom\s+Failing · 100% server errors over \d+ min · 25 of 25 calls/),
        tab.shows(/500 “fixture boom: the invoice has no customer” × 25/),
        tab.shows(/GET \/fx\/slow\s+Slow · p95 \d+ ms · avg \d+ ms · 25 calls/),
        tab.shows(/GET \/fx\/missing\s+4xx rate · 100% client errors · 25 of 25 calls/),
        tab.shows(/404 “fixture not found” × 25/),
        tab.shows(/1 route failing\s+1 slow route \(≥ 50 ms\)/),
        tab.shows(/View 25 server errors/),
        tab.shows(/p95 \d+ ms · max \d+ ms · 25 calls/),
      ]);
      await tab.click({ role: "link", name: "GET /fx/boom Failing · 100% server errors over", exact: false });
      await ctx.verify("a row opens the logs on the route's 5xx", [tab.at(/\/modules\/api\/logs$/), check("the URL narrows to the route and the 5xx tab", /route=GET\+%2Ffx%2Fboom/.test(tab.page.url()) && /requests\.tab=5xx/.test(tab.page.url()), tab.page.url())]);
    },
  },
  {
    id: "the-period-and-the-comparison-are-kept-in-the-url-and-shared-by-the-pages",
    title: "the 1H, 24H, 7D and 30D presets and the No comparison choice set ?api.period and ?api.compare, drop the compared figures, and carry over to Request logs and Routes; ?live=0 opens a page paused",
    entryPoint: "/modules/api/overview?api.period=...",
    async run(/** @type {Ctx} */ ctx) {
      await traffic(ctx, "some traffic", [{ path: "/fx/ok", count: 5 }, { path: "/fx/boom", count: 2 }]);
      const compared = await settled(ctx, "traffic with the default comparison", "/overview/traffic?preset=last-24h&comparison=previous-period", (body) => num(body, "value") === 7);
      const alone = await mon(ctx, "traffic without comparison", "/overview/traffic?preset=last-24h&comparison=none");
      const seriesOf = (/** @type {unknown} */ body) => list(body, "series").map((entry) => text(entry, "name"));
      await ctx.verify("the API honours the comparison", [
        same("the comparison is named in the window", [pick(compared.body, "window", "comparison"), pick(alone.body, "window", "comparison")], ["previous-period", "none"]),
        same("the previous period is named, or none", [pick(compared.body, "window", "previous") !== null, pick(alone.body, "window", "previous")], [true, null]),
        same("No comparison draws none", seriesOf(alone.body).filter((name) => /compare/.test(name)), []),
        same("the total is the period's own", [num(compared.body, "value"), num(alone.body, "value")], [7, 7]),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/overview");
      await ctx.verify("the default", [
        isOn(tab, { role: "radio", name: "Last 24 hours" }),
        tab.visible({ role: "button", name: /^Comparison: vs previous period/ }),
      ]);
      await tab.click({ role: "radio", name: "Last 7 days" });
      await ctx.verify("7D", [check("the URL names the period", /api\.period=last-7-days/.test(tab.page.url()), tab.page.url()), isOn(tab, { role: "radio", name: "Last 7 days" })]);
      await tab.click({ role: "radio", name: "Last hour" });
      await ctx.verify("1H", [check("the URL names the period", /api\.period=last-hour/.test(tab.page.url()), tab.page.url())]);
      await tab.click({ role: "radio", name: "Last 30 days" });
      await ctx.verify("30D", [check("the URL names the period", /api\.period=last-30-days/.test(tab.page.url()), tab.page.url())]);
      await tab.click({ role: "radio", name: "Last 24 hours" });
      await tab.click({ role: "button", name: /^Comparison:/ });
      await tab.click({ role: "menuitem", name: "No comparison" });
      await ctx.verify("No comparison", [
        check("the URL names it", /api\.compare=none/.test(tab.page.url()), tab.page.url()),
        tab.visible({ role: "button", name: /^Comparison: No comparison/ }),
      ]);
      await openPage(tab, "/modules/api/logs");
      await ctx.verify("the Request logs open on the last choice", [isOn(tab, { role: "radio", name: "Last 24 hours" })]);
      await openPage(tab, "/modules/api/overview");
      await tab.click({ role: "radio", name: "Last 7 days" });
      await openPage(tab, "/modules/api/routes");
      await ctx.verify("Routes open on the last choice", [isOn(tab, { role: "radio", name: "Last 7 days" })]);
      await openPage(tab, "/modules/api/overview?live=0");
      await ctx.verify("?live=0", [isOn(tab, { role: "button", name: "Pause" }), isOn(tab, { role: "button", name: "Live" }, false)]);
    },
  },
  {
    id: "down-reads-the-last-five-minutes-and-not-the-last-fifteen",
    title: "10 failing calls out of 20 in the last 5 minutes read Down although 100 good calls 10 minutes ago keep the 15-minute rate under 20%; the same errors 10 minutes ago and 20 good calls now read Degraded, not Down",
    entryPoint: "GET /api/monitoring/overview/health",
    async run(/** @type {Ctx} */ ctx) {
      await seedLogs(ctx, "100 good calls 10 minutes ago", { minutesAgo: 10, count: 100 });
      await traffic(ctx, "10 good and 10 failing now", [{ path: "/fx/ok", count: 10 }, { path: "/fx/boom", count: 10 }]);
      const recent = await settled(ctx, "health with a recent burst", "/overview/health", (body) => num(body, "metrics", "requests") === 120);
      await ctx.verify("a recent burst", [
        same("the verdict", text(recent.body, "verdict"), "down"),
        same("the 15-minute rate is the 10 errors over 120 calls", [num(recent.body, "metrics", "requests"), Math.round((num(recent.body, "metrics", "serverErrorRate") ?? 0) * 10) / 10], [120, 8.3]),
      ]);
    },
  },
  {
    id: "errors-older-than-five-minutes-do-not-make-the-api-down",
    title: "40 failing calls out of 120 ten minutes ago and 20 good calls now (28.6% over 15 minutes, 0% over 5) read Degraded, not Down",
    entryPoint: "GET /api/monitoring/overview/health",
    async run(/** @type {Ctx} */ ctx) {
      await seedLogs(ctx, "80 good calls 10 minutes ago", { minutesAgo: 10, count: 80 });
      await seedLogs(ctx, "40 failing calls 10 minutes ago", { minutesAgo: 10, count: 40, uri: "/fx/boom", statusCode: 500, message: "seeded" });
      await traffic(ctx, "20 good calls now", [{ path: "/fx/ok", count: 20 }]);
      const aged = await settled(ctx, "health with aged errors", "/overview/health", (body) => num(body, "metrics", "requests") === 140);
      await ctx.verify("aged errors", [
        same("the verdict", text(aged.body, "verdict"), "degraded"),
        same("the 15-minute rate is the 40 errors over 140 calls", Math.round((num(aged.body, "metrics", "serverErrorRate") ?? 0) * 10) / 10, 28.6),
      ]);
    },
  },
  {
    id: "the-module-path-redirects-to-the-overview",
    title: "opening /modules/api lands on /modules/api/overview, and the menu lists Overview, Request logs, Routes and API settings under Monitor, Explore and Configure",
    entryPoint: "/modules/api",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api");
      await ctx.verify("the redirect", [
        tab.at(/^\/modules\/api\/overview$/),
        tab.visible({ role: "heading", name: "Overview", level: 1 }),
        tab.visible({ role: "link", name: "Overview", within: { role: "navigation" } }),
        tab.visible({ role: "link", name: "Request logs" }),
        tab.visible({ role: "link", name: "Routes" }),
        tab.visible({ role: "link", name: "API settings" }),
        tab.shows(/MONITOR\s+Overview\s+Request logs\s+EXPLORE\s+Routes\s+CONFIGURE\s+API settings/),
      ]);
    },
  },
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
]);
