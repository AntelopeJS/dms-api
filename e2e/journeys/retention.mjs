import { guarded } from "../guard.mjs";
import { mon, num, same, settled, openPage } from "../api.mjs";
import { seedLogs } from "../seed.mjs";

/** @typedef {import("../api.mjs").Ctx} Ctx */

export const journeys = guarded([
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
