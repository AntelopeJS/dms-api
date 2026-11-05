import { mon } from "../../api.mjs";

/** @typedef {import("../../api.mjs").Ctx} Ctx */

/**
 * @param {string} ref A route reference such as `GET /fx/ok`
 * @returns {string} The query string that names it
 */
export const named = (ref) => `route=${encodeURIComponent(ref)}`;

/**
 * @param {Ctx} ctx The journey
 * @param {string} ref The route
 * @returns {Promise<import("../../api.mjs").Answer>} The route's detail
 */
export const detail = (ctx, ref) => mon(ctx, `detail of ${ref}`, `/routes/detail?${named(ref)}`);
