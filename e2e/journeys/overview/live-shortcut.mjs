import { isOn, num, settled, traffic, openPage } from "../../api.mjs";

/** @typedef {import("../../api.mjs").Ctx} Ctx */

/** The overview journeys about the Live and Pause key. */
export const liveShortcut = [
  {
    id: "l-switches-the-page-between-live-and-pause",
    title: "the L key pauses the Overview, which then counts the requests it did not read, the choice holds on the Routes and Request logs pages, and a second press makes the page live again",
    entryPoint: "/modules/api/overview",
    async run(/** @type {Ctx} */ ctx) {
      await traffic(ctx, "before the pause", [{ path: "/fx/ok", count: 2 }]);
      await settled(ctx, "counted", "/overview/health", (body) => num(body, "metrics", "requests") === 2);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/overview");
      await ctx.verify("live by default", [isOn(tab, { role: "button", name: "Live" })]);
      await tab.press("l");
      await ctx.verify("L pauses", [isOn(tab, { role: "button", name: "Pause" })]);
      await traffic(ctx, "while paused", [{ path: "/fx/ok", count: 2 }, { path: "/fx/boom", count: 1 }]);
      await ctx.verify("the paused page counts what it did not read", [tab.shows(/Paused · 3 new requests · 1 in 5xx/)]);
      await openPage(tab, "/modules/api/routes");
      await ctx.verify("the Routes page is paused too", [isOn(tab, { role: "button", name: "Pause" })]);
      await openPage(tab, "/modules/api/logs");
      await ctx.verify("and the Request logs", [isOn(tab, { role: "button", name: "Pause" })]);
      await tab.press("l");
      await ctx.verify("L makes it live again", [isOn(tab, { role: "button", name: "Live" })]);
      await openPage(tab, "/modules/api/overview");
      await ctx.verify("the Overview is live", [isOn(tab, { role: "button", name: "Live" })]);
    },
  },
];
