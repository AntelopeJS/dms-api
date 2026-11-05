import { list, mon, num, text } from "../../api.mjs";

/** @typedef {import("../../api.mjs").Ctx} Ctx */

/**
 * @param {Ctx} ctx The journey
 * @param {string} label What is asked
 * @param {string} query The list query
 * @returns {Promise<{ total: number | undefined, paths: string[], messages: string[] }>} What the list holds
 */
export async function listed(ctx, label, query) {
  const answer = await mon(ctx, label, `/logs?preset=last-24h&${query}`);
  const rows = list(answer.body, "results");
  return { total: num(answer.body, "total"), paths: rows.map((row) => text(row, "path")), messages: rows.map((row) => text(row, "message")) };
}
