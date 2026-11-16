import { check, num, same, settled, text, traffic, openPage } from "../../api.mjs";

/** @typedef {import("../../api.mjs").Ctx} Ctx */

/**
 * @param {string} ref A route reference
 * @returns {string} The query that names it
 */
export const named = (ref) => `route=${encodeURIComponent(ref)}`;


/**
 * Sends `good` fast calls and `bad` failing calls, waits until the console has counted them, and reads the verdict
 * through the API and the Overview's hero.
 *
 * @param {Ctx} ctx The journey
 * @param {{ good: number, bad: number, verdict: string, label: string, rate: number }} plan What to send and what must be read
 */
export async function verdictOf(ctx, plan) {
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
