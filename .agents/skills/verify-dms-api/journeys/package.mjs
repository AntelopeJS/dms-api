import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { guarded } from "../guard.mjs";
import { check, isRow, isText, list, parseJson, pick, same, text } from "../api.mjs";

/** @typedef {import("../api.mjs").Ctx} Ctx */

const NO_DATABASE = { database: "shared", onboard: false };

/**
 * @param {Ctx} ctx The journey
 * @param {string} path A path in the checkout
 * @returns {string} The file's text
 */
const read = (ctx, path) => readFileSync(join(ctx.state.repo, path), "utf8");

/**
 * @param {Ctx} ctx The journey
 * @param {string} path A JSON file in the checkout
 * @returns {unknown} Its value
 */
const readJson = (ctx, path) => parseJson(read(ctx, path));

/**
 * @param {unknown} value A JSON value
 * @returns {string[]} The strings of an array value
 */
const strings = (value) => (Array.isArray(value) ? value.filter(isText) : []);

/**
 * @param {unknown} value A value
 * @param {unknown} range A semver range
 * @param {Ctx} ctx The journey
 * @returns {boolean} Whether the version satisfies the range
 */
function satisfies(value, range, ctx) {
  /** @type {unknown} */
  const semver = createRequire(join(ctx.state.repo, "package.json"))("semver");
  const compare = pick(semver, "satisfies");
  return compare instanceof Function ? Boolean(compare.call(semver, value, range)) : false;
}

export const journeys = guarded([
  {
    id: "the-tarball-holds-what-the-manifest-names",
    title: "the package ships dist, the Vue layer and the skill, declares the skill and the frontend module, and leaves out sources, tests, the playground and the verification skill",
    entryPoint: "npm pack",
    ...NO_DATABASE,
    async run(/** @type {Ctx} */ ctx) {
      const manifest = readJson(ctx, "package.json");
      const packed = parseJson(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ctx.state.repo, encoding: "utf8" }));
      const files = Array.isArray(packed) ? list(packed[0], "files").map((entry) => text(entry, "path")) : [];
      const folder = ctx.step("npm pack");
      ctx.record(folder, [
        same("main", pick(manifest, "main"), "dist/index.js"),
        same("the shipped folders", pick(manifest, "files"), ["dist", "frontend-vue", "skills"]),
        same("the skills folder is declared", pick(manifest, "antelopeJs", "skills"), ["./skills"]),
        same("the frontend module is declared", pick(manifest, "dmsFrontend"), "dist/frontend-module.js"),
        check("the built entry is packed", files.includes("dist/index.js"), files.length),
        check("the frontend module is packed", files.includes("dist/frontend-module.js"), files.length),
        check("the Vue layer is packed", files.includes("frontend-vue/dms.frontend.ts") && files.includes("frontend-vue/package.json"), files.length),
        check("the skill is packed", files.includes("skills/dms-api/SKILL.md") && files.includes("skills/dms-api/cases.json"), files.length),
        same("nothing else but the manifest, licence and readme", files.filter((path) => !/^(dist|frontend-vue|skills)\//.test(path)).toSorted((left, right) => left.localeCompare(right)), ["LICENSE", "README.md", "package.json"]),
        same("no source, test or playground file is packed", files.filter((path) => /^(src|tests|playground|\.agents|docs)\//.test(path)), []),
        same("no installed dependency is packed", files.filter((path) => path.includes("node_modules/")), []),
      ]);
    },
  },
  {
    id: "the-ranges-and-the-skill-match-what-the-docs-name",
    title: "the renderer range of the Vue layer admits the installed renderer, the installation docs' version range admits this version, the README table lists every interface the module depends on, and the skill's frontmatter and cases are valid",
    entryPoint: "README, docs/2.installation.md, frontend-vue/package.json, skills/dms-api",
    ...NO_DATABASE,
    async run(/** @type {Ctx} */ ctx) {
      const manifest = readJson(ctx, "package.json");
      const frontend = readJson(ctx, "frontend-vue/package.json");
      const renderer = readJson(ctx, "playground/node_modules/@antelopejs/dms-frontend/package.json");
      const readme = read(ctx, "README.md");
      const table = readme.slice(readme.indexOf("antelopejs-docs-compat:start"), readme.indexOf("antelopejs-docs-compat:end"));
      const keysOfRow = (/** @type {unknown} */ value) => (isRow(value) ? Object.keys(value) : []);
      const names = [...keysOfRow(pick(manifest, "dependencies")), ...keysOfRow(pick(manifest, "optionalDependencies"))];
      const interfaces = names.filter((name) => name.startsWith("@antelopejs/interface-"));
      const installation = read(ctx, "docs/2.installation.md");
      const range = /version: "([^"]+)"/.exec(installation)?.[1] ?? "";
      const skill = read(ctx, "skills/dms-api/SKILL.md");
      const cases = list(readJson(ctx, "skills/dms-api/cases.json"), "cases");
      const engines = text(frontend, "engines", "@antelopejs/dms-frontend");
      await ctx.verify("ranges", [
        check("the renderer installed is inside the Vue layer's engines range", satisfies(text(renderer, "version"), engines, ctx), `${text(renderer, "version")} in ${engines}`),
        check("this version is inside the range the installation docs show", satisfies(text(manifest, "version"), range, ctx), `${text(manifest, "version")} in ${range}`),
        same("the README table lists each interface dependency", interfaces.filter((name) => !table.includes(`\`${name}\``)), []),
        check("the docs name the module's package", installation.includes('package: "@antelopejs/dms-api"'), range),
      ]);
      await ctx.verify("the skill", [
        check("the frontmatter names dms-api", skill.startsWith("---\nname: dms-api\n"), skill.slice(0, 40)),
        check("it names the three automation nodes", ["api.route-unhealthy", "api.get-api-health", "api.query-request-logs"].every((node) => skill.includes(node)), "nodes"),
        check("the cases file is version 1, its ids are unique and the skill is expected by the cases that name it", pick(readJson(ctx, "skills/dms-api/cases.json"), "version") === 1 && cases.length > 0 && new Set(cases.map((entry) => text(entry, "id"))).size === cases.length && cases.some((entry) => strings(pick(entry, "expect", "skills")).includes("dms-api")), cases.length),
      ]);
    },
  },
  {
    id: "the-docs-links-and-the-two-locales-are-complete",
    title: "every console link of the docs points at a page that exists, the docs navigation lists the pages, and the English and French locale files hold the same keys",
    entryPoint: "docs/, frontend-vue/i18n/locales",
    ...NO_DATABASE,
    async run(/** @type {Ctx} */ ctx) {
      const pages = ["introduction", "installation", "configuration", "extending", "faq", "usage/overview", "usage/request-logs", "usage/routes", "usage/settings"];
      const files = ["1.introduction.md", "2.installation.md", "3.configuration.md", "5.extending.md", "6.faq.md", "4.usage/1.overview.md", "4.usage/2.request-logs.md", "4.usage/3.routes.md", "4.usage/4.settings.md"];
      const docs = files.map((file) => read(ctx, `docs/${file}`)).join("\n");
      const unknown = [...docs.matchAll(/\/docs\/modules\/api\/([a-z/-]+)/g)].map((match) => match[1] ?? "").filter((target) => !pages.includes(target));
      /**
       * @param {unknown} value A locale value
       * @param {string} [prefix] The path so far
       * @returns {string[]} The dotted keys of its leaves
       */
      const keysOf = (value, prefix = "") => (isRow(value) ? Object.entries(value).flatMap(([key, inner]) => keysOf(inner, `${prefix}${key}.`)) : [prefix]);
      const byName = (/** @type {string} */ left, /** @type {string} */ right) => left.localeCompare(right);
      const english = keysOf(readJson(ctx, "frontend-vue/i18n/locales/api-en-GB.json")).toSorted(byName);
      const french = keysOf(readJson(ctx, "frontend-vue/i18n/locales/api-fr-FR.json")).toSorted(byName);
      await ctx.verify("links", [
        same("every page exists", files.filter((file) => !existsSync(join(ctx.state.repo, "docs", file))), []),
        same("no console link points at a missing page", unknown, []),
        same("the README links the module's documentation", readme(ctx).includes("https://dms.antelopejs.com/docs/modules/api"), true),
        same("the navigation names the section", read(ctx, "docs/.navigation.yml").includes("title: API"), true),
      ]);
      await ctx.verify("locales", [
        same("French lacks no English key", english.filter((key) => !french.includes(key)), []),
        same("English lacks no French key", french.filter((key) => !english.includes(key)), []),
        check("the locale files are not empty", english.length > 50, english.length),
      ]);
    },
  },
]);

/**
 * @param {Ctx} ctx The journey
 * @returns {string} The README
 */
function readme(ctx) {
  return read(ctx, "README.md");
}
