import { guarded } from "../guard.mjs";
import { check, list, num, same, settled, text, traffic, openPage } from "../api.mjs";

/** @typedef {import("../api.mjs").Ctx} Ctx */

export const journeys = guarded([
  {
    id: "traffic-shows-in-the-overview-and-the-request-logs",
    title: "an owner sends the project's routes 25 good calls and one failing call, reads the Degraded verdict on the Overview and finds the failing request in the Request logs",
    entryPoint: "/modules/api/overview and /modules/api/logs",
    async run(/** @type {Ctx} */ ctx) {
      const statuses = await traffic(ctx, "25 ok and one boom", [{ path: "/fx/ok", count: 25 }, { path: "/fx/boom", count: 1 }]);
      const logs = await settled(ctx, "the logs hold the 26 calls", "/logs", (body) => num(body, "total") === 26);
      const health = await settled(ctx, "health", "/overview/health", (body) => text(body, "verdict") !== "idle");
      await ctx.verify("the API", [
        same("the statuses sent", statuses, { 200: 25, 500: 1 }),
        same("26 requests are captured", num(logs.body, "total"), 26),
        same("the verdict is degraded: 1 server error in 26 calls is above 1%", text(health.body, "verdict"), "degraded"),
        check("5xx rate over the window is 1 in 26", Math.abs((num(health.body, "metrics", "serverErrorRate") ?? 0) - 100 / 26) < 0.01, num(health.body, "metrics", "serverErrorRate")),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/overview");
      await ctx.verify("the Overview", [
        tab.visible({ role: "heading", name: "Overview", level: 1 }),
        tab.shows(/Degraded/),
        tab.shows(/View 1 server error/),
      ]);
      await openPage(tab, "/modules/api/logs");
      await ctx.verify("the Request logs", [
        tab.visible({ role: "button", name: "All 26" }),
        tab.visible({ role: "button", name: "5xx 1" }),
        tab.shows(/fixture boom: the invoice has no customer/),
      ]);
      await tab.click({ role: "button", name: "5xx 1" });
      await tab.click({ role: "button", name: "Open request" });
      await ctx.verify("the request drawer", [tab.shows(/GET \/fx\/boom/), tab.shows(/fixture boom: the invoice has no customer/)]);
      const row = list(logs.body, "results").find((entry) => text(entry, "path") === "/fx/boom");
      await ctx.verify("the failing row", [check("it is a 500 on the boom route", text(row, "status") === "500" && text(row, "route") === "GET /fx/boom", row)]);
    },
  },
]);
