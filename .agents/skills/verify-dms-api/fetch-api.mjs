import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "api-module");
const work = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "verify-dms-api-api-pack-"));
const VERSION = "1.6.0";
const EDITS = [
  ["dist/implementations/api/index.js", "handler.proto.constructor", "handler.controller ?? handler.proto.constructor"],
  ["node_modules/@antelopejs/interface-api/dist/routes.js", "proto: target,", "proto: target,\n            controller: target.constructor,"],
];

/**
 * The module names a registered route's controller with
 * `RouteHandler.controller` and registers its webhook routes with it, while
 * the published @antelopejs/api and its interface still build and read
 * `proto`. This unpacks the published package into the skill folder and lets
 * it build handlers that carry both, and read `controller` first, so the
 * module and the api agree on one route handler.
 */
if (existsSync(target)) rmSync(target, { recursive: true, force: true });
execFileSync("npm", ["pack", `@antelopejs/api@${VERSION}`, "--silent", "--pack-destination", work], { stdio: "ignore" });
execFileSync("tar", ["-xzf", join(work, `antelopejs-api-${VERSION}.tgz`), "-C", work]);
cpSync(join(work, "package"), target, { recursive: true });
execFileSync("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock"], { cwd: target, stdio: "ignore" });
for (const [path, from, to] of EDITS) {
  const file = join(target, path);
  const source = readFileSync(file, "utf8");
  if (!source.includes(from)) throw new Error(`@antelopejs/api ${VERSION} no longer has ${from} in ${path}`);
  writeFileSync(file, source.replace(from, to));
}
rmSync(work, { recursive: true, force: true });
