import { readFileSync } from "node:fs";
import { join } from "node:path";
import { guarded } from "../guard.mjs";
import { check, mon, num, same, text, traffic } from "../api.mjs";

/** @typedef {import("../api.mjs").Ctx} Ctx */

export const journeys = guarded([
  {
    id: "without-the-automation-module-the-registration-is-a-silent-no-op",
    title: "with no @antelopejs/dms-automation in the project the module starts, says only that the optional interface has no provider, logs no error about the nodes, and the console keeps working",
    entryPoint: "the backend log of the start and GET /api/monitoring/overview/health",
    async run(/** @type {Ctx} */ ctx) {
      await ctx.restartBackend();
      await traffic(ctx, "a call", [{ path: "/fx/ok", count: 1 }]);
      const log = readFileSync(join(ctx.state.logs, "backend.log"), "utf8").split("\n");
      const start = log.map((line) => /Server started/.test(line)).lastIndexOf(true);
      const lines = log.slice(Math.max(0, start - 60));
      const health = await mon(ctx, "health", "/overview/health");
      const settings = await mon(ctx, "settings", "/settings");
      await ctx.verify("the start", [
        check("the log says the optional automation interface has no provider", lines.some((line) => /Optional interface '@antelopejs\/interface-dms-automation' has no provider/.test(line)), lines.filter((line) => /automation/i.test(line))),
        same("no error line names the automation nodes", lines.filter((line) => /\[ERROR\]/.test(line) && /automation|api\.route-unhealthy|api\.get-api-health|api\.query-request-logs/i.test(line)), []),
        same("no line says dms-api failed", lines.filter((line) => /dms-api/.test(line) && /(failed|did not construct|Failed to)/i.test(line)), []),
        same("the console answers", [health.status, settings.status, num(settings.body, "statisticsLifetimeDays")], [200, 200, 90]),
        check("the health reads the call", text(health.body, "verdict") !== "", text(health.body, "verdict")),
      ]);
    },
  },
]);
