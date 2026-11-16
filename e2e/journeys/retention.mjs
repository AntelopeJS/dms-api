import { fileURLToPath } from "node:url";
import { guarded } from "../guard.mjs";
import { list, mon, num, same, saveSettings, settled, openPage } from "../api.mjs";
import { dayStart, readDocuments, seedLogs, seedStatistics } from "../seed.mjs";

/** @typedef {import("../api.mjs").Ctx} Ctx */

export const journeys = guarded([
  {
    id: "lowering-a-retention-tells-what-the-next-prune-deletes",
    title: "the retention impact counts the logs and the days of statistics older than the value, and refuses a value outside the bounds or an unknown field",
    entryPoint: "GET /api/monitoring/settings/retention-impact",
    async run(/** @type {Ctx} */ ctx) {
      await seedLogs(ctx, "40 days old", { daysAgo: 40, count: 3 });
      await seedLogs(ctx, "99.5 days old", { daysAgo: 99.5, count: 2 });
      await seedStatistics(ctx, "50 days old", { method: "GET", uri: "/fx/ok", daysAgo: 50, requests: 4 });
      await seedStatistics(ctx, "70 days old", { method: "GET", uri: "/fx/ok", daysAgo: 70, requests: 6 });
      const read = (/** @type {string} */ field, /** @type {number} */ days) => mon(ctx, `${field} at ${days}`, `/settings/retention-impact?field=${field}&days=${days}`);
      const figures = (/** @type {import("../api.mjs").Answer} */ answer) => [num(answer.body, "days"), num(answer.body, "requests")];
      const logs30 = await read("requestLogRetentionDays", 30);
      const logs60 = await read("requestLogRetentionDays", 60);
      const logs366 = await read("requestLogRetentionDays", 366);
      const stats30 = await read("statisticsLifetimeDays", 30);
      const stats60 = await read("statisticsLifetimeDays", 60);
      const stats90 = await read("statisticsLifetimeDays", 90);
      const unknown = await read("nope", 30);
      const zero = await read("requestLogRetentionDays", 0);
      const over = await read("requestLogRetentionDays", 367);
      await ctx.verify("impact", [
        same("logs older than 30 days: the days back they reach and the requests", figures(logs30), [70, 5]),
        same("logs older than 60 days", figures(logs60), [40, 2]),
        same("logs older than 366 days", figures(logs366), [0, 0]),
        same("statistics older than 30 days: the 50 and 70 day old rollups", figures(stats30), [2, 10]),
        same("statistics older than 60 days: the 70 day old rollup", figures(stats60), [1, 6]),
        same("statistics older than 90 days", figures(stats90), [0, 0]),
        same("an unknown field is refused", unknown.status, 400),
        same("0 days is refused", zero.status, 400),
        same("367 days is refused", over.status, 400),
      ]);
    },
  },
  {
    id: "the-hourly-prune-deletes-what-the-retention-passed",
    title: "at the turn of the hour the prune deletes the request logs older than the log retention and the days of statistics older than the statistics retention, and keeps everything newer",
    entryPoint: "the hourly job of the module",
    async run(/** @type {Ctx} */ ctx) {
      await saveSettings(ctx, "keep logs 20 days and statistics 30 days", { requestLogRetentionDays: 20, statisticsLifetimeDays: 30 });
      await seedLogs(ctx, "39.5 days old", { daysAgo: 39.5, count: 3 });
      await seedLogs(ctx, "25 days old", { daysAgo: 25, count: 2, uri: "/fx/boom", statusCode: 500 });
      await seedLogs(ctx, "10 days old", { daysAgo: 10, count: 4 });
      await seedLogs(ctx, "an hour old", { daysAgo: 1 / 24, count: 1 });
      await seedStatistics(ctx, "100 days old", { method: "GET", uri: "/fx/ok", daysAgo: 100, requests: 4 });
      await seedStatistics(ctx, "40 days old", { method: "GET", uri: "/fx/ok", daysAgo: 40, requests: 6 });
      await seedStatistics(ctx, "10 days old", { method: "GET", uri: "/fx/ok", daysAgo: 10, requests: 8 });
      const impact = await mon(ctx, "what the next prune deletes", "/settings/retention-impact?field=requestLogRetentionDays&days=20");
      const seeded = () => readDocuments(ctx, "dms-api__request_log", { userAgent: "seed" });
      const before = (await seeded()).length;
      const toNextHour = 3_600_000 - (Date.now() % 3_600_000);
      const offset = (toNextHour > 20_000 ? toNextHour : toNextHour + 3_600_000) - 12_000;
      const previous = { ...ctx.state.extraEnv };
      ctx.state.extraEnv = { ...previous, NODE_OPTIONS: `--require ${fileURLToPath(new URL("../clock.cjs", import.meta.url))}`, VERIFY_API_CLOCK_OFFSET_MS: String(offset) };
      try {
        await ctx.restartBackend();
        const deadline = Date.now() + 90_000;
        let after = before;
        while (Date.now() < deadline && after > 5) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          after = (await seeded()).length;
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } finally {
        ctx.state.extraEnv = previous;
      }
      const logs = await seeded();
      const ages = logs.map((row) => Math.round((Date.now() - new Date(String(row.timestamp)).getTime()) / 86_400_000)).toSorted((left, right) => left - right);
      const stats = await readDocuments(ctx, "dms-api__routes_statistics", { _id: "GET:/fx/ok" });
      const kept = stats[0]?.statistics;
      const days = (Array.isArray(kept) ? list(kept) : []).map((entry) => num(entry, "day") ?? 0).toSorted((left, right) => left - right);
      await ctx.verify("the prune", [
        same("the impact said 5 requests reaching back 20 days before", [num(impact.body, "days"), num(impact.body, "requests")], [20, 5]),
        same("the logs before", before, 10),
        same("the logs left are the four 10 days old and the hour old one", ages, [0, 10, 10, 10, 10]),
        same("the statistics left are the 10 days old and the 40 days old are gone with the 100 days old", days, [dayStart(10)]),
      ]);
    },
  },
  {
    id: "lowering-a-retention-asks-before-it-deletes",
    title: "lowering the log retention shows what the next prune deletes under the field, Save changes asks \"Delete stored data?\" with the old and new values and the count, Cancel keeps 30 days, Save and delete writes 7",
    entryPoint: "/modules/api/settings",
    async run(/** @type {Ctx} */ ctx) {
      await seedLogs(ctx, "19.5 days old", { daysAgo: 19.5, count: 3 });
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/settings");
      await tab.fill({ role: "spinbutton", name: "Request logs (days)" }, "7");
      await tab.press("Tab");
      await ctx.verify("the field", [tab.shows(/The next hourly prune deletes 13 days of request logs \(3 requests\)\./), tab.shows(/Unsaved changes · Retention/)]);
      await tab.click({ role: "button", name: "Save changes" });
      await ctx.verify("the confirmation", [tab.shows(/Delete stored data\?/), tab.shows(/A lower retention deletes the data older than it at the next hourly prune\. This cannot be undone\./), tab.shows(/Request logs: 30 → 7 days\s+≈ 3 requests/)]);
      await tab.click({ role: "button", name: "Cancel" });
      const kept = await mon(ctx, "after Cancel", "/settings");
      await tab.click({ role: "button", name: "Save changes" });
      await tab.click({ role: "button", name: "Save and delete" });
      const saved = await settled(ctx, "after Save and delete", "/settings", (body) => num(body, "requestLogRetentionDays") === 7);
      await ctx.verify("the outcome", [
        same("Cancel changed nothing", num(kept.body, "requestLogRetentionDays"), 30),
        same("Save and delete writes the new retention", num(saved.body, "requestLogRetentionDays"), 7),
      ]);
    },
  },
]);
