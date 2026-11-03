import { guarded } from "../guard.mjs";
import { check, isOn, list, mon, num, pick, same, saveSettings, settled, text, traffic, openPage } from "../api.mjs";

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
        same("the previous period is drawn as one more series", [seriesOf(compared.body).length, seriesOf(alone.body).length], [4, 3]),
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
]);
