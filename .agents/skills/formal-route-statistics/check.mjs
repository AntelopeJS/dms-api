#!/usr/bin/env node
/**
 * Model-checks the per-route statistics rollup of @antelopejs/dms-api with
 * TLC through the shared runner of @antelopejs/tooling-configs:
 * RouteStatistics.tla with one prune beside the two replicas' writes, then
 * with the prunes of both replicas' crons.
 *
 * With no argument it runs the CI configuration of each (`<config>.ci.cfg`);
 * with `--full` it runs the full one (`<config>.cfg`). Exits 0 when both
 * match the record in SKILL.md, 1 when a rule changed, and 2 when TLC could
 * not run. The runner exits on the first configuration that changed, so a
 * change with one prune skips the run with two.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSpec, EXIT } from "@antelopejs/tooling-configs/formal";

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * The rules each configuration breaks today, with the states in TLC's
 * shortest counterexample, in run order. Every rule holds at the sync commit.
 */
const CONFIGS = {
  OnePrune: { ci: {}, full: {} },
  TwoPrunes: { ci: {}, full: {} },
};

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--full")) {
  console.error("usage: node check.mjs [--full]");
  process.exit(EXIT.tool);
}
const mode = args.includes("--full") ? "full" : "ci";

for (const [config, findings] of Object.entries(CONFIGS)) {
  await checkSpec({
    dir,
    spec: "RouteStatistics",
    config: mode === "full" ? config : `${config}.ci`,
    findings: findings[mode],
  });
}
