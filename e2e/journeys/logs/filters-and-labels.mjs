import { isOn, list, mon, pick, same, saveSettings, settled, text, traffic, openPage } from "../../api.mjs";
import { seedLogs } from "../../seed.mjs";

/** @typedef {import("../../api.mjs").Ctx} Ctx */

/** The logs journeys about filters and labels. */
export const filtersAndLabels = [
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
      const order = (/** @type {import("../../api.mjs").Answer} */ answer) => list(answer.body, "results").map((row) => text(row, "path"));
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
];
