import { verdictOf } from "./shared.mjs";

/** @typedef {import("../../api.mjs").Ctx} Ctx */

/** The overview journeys about verdict. */
export const verdict = [
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
];
