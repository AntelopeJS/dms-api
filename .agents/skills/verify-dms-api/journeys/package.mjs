import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { guarded } from "../guard.mjs";
import { check, same } from "../api.mjs";

/** @typedef {import("../api.mjs").Ctx} Ctx */

const NO_DATABASE = { database: "shared", onboard: false };

/**
 * @param {Ctx} ctx The journey
 * @param {string} path A path in the checkout
 * @returns {string} The file's text
 */
const read = (ctx, path) => readFileSync(join(ctx.state.repo, path), "utf8");

export const journeys = guarded([
  {
    id: "the-tarball-holds-what-the-manifest-names",
    title: "the package ships dist, the Vue layer and the skill, declares the skill and the frontend module, and leaves out sources, tests, the playground and the verification skill",
    entryPoint: "npm pack",
    ...NO_DATABASE,
    async run(/** @type {Ctx} */ ctx) {
      const manifest = JSON.parse(read(ctx, "package.json"));
      const packed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ctx.state.repo, encoding: "utf8" }));
      const files = /** @type {string[]} */ (packed[0].files.map((/** @type {{ path: string }} */ entry) => entry.path));
      const folder = ctx.step("npm pack");
      ctx.record(folder, [
        same("main", manifest.main, "dist/index.js"),
        same("the shipped folders", manifest.files, ["dist", "frontend-vue", "skills"]),
        same("the skills folder is declared", manifest.antelopeJs.skills, ["./skills"]),
        same("the frontend module is declared", manifest.dmsFrontend, "dist/frontend-module.js"),
        check("the built entry is packed", files.includes("dist/index.js"), files.length),
        check("the frontend module is packed", files.includes("dist/frontend-module.js"), files.length),
        check("the Vue layer is packed", files.includes("frontend-vue/dms.frontend.ts") && files.includes("frontend-vue/package.json"), files.length),
        check("the skill is packed", files.includes("skills/dms-api/SKILL.md") && files.includes("skills/dms-api/cases.json"), files.length),
        same("nothing else but the manifest, licence and readme", files.filter((path) => !/^(dist|frontend-vue|skills)\//.test(path)).sort(), ["LICENSE", "README.md", "package.json"]),
        same("no source, test or playground file is packed", files.filter((path) => /^(src|tests|playground|\.agents|docs)\//.test(path)), []),
        same("no installed dependency is packed", files.filter((path) => /node_modules\//.test(path)), []),
      ]);
    },
  },
  {
    id: "the-ranges-and-the-skill-match-what-the-docs-name",
    title: "the renderer range of the Vue layer admits the installed renderer, the installation docs' version range admits this version, the README table lists every interface the module depends on, and the skill's frontmatter and cases are valid",
    entryPoint: "README, docs/2.installation.md, frontend-vue/package.json, skills/dms-api",
    ...NO_DATABASE,
    async run(/** @type {Ctx} */ ctx) {
      const manifest = JSON.parse(read(ctx, "package.json"));
      const frontend = JSON.parse(read(ctx, "frontend-vue/package.json"));
      const semver = createRequire(join(ctx.state.repo, "package.json"))("semver");
      const renderer = JSON.parse(read(ctx, "playground/node_modules/@antelopejs/dms-frontend/package.json"));
      const readme = read(ctx, "README.md");
      const table = readme.slice(readme.indexOf("antelopejs-docs-compat:start"), readme.indexOf("antelopejs-docs-compat:end"));
      const interfaces = Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }).filter((name) => name.startsWith("@antelopejs/interface-"));
      const installation = read(ctx, "docs/2.installation.md");
      const range = /version: "([^"]+)"/.exec(installation)?.[1] ?? "";
      const skill = read(ctx, "skills/dms-api/SKILL.md");
      const cases = JSON.parse(read(ctx, "skills/dms-api/cases.json"));
      await ctx.verify("ranges", [
        check("the renderer installed is inside the Vue layer's engines range", semver.satisfies(renderer.version, frontend.engines["@antelopejs/dms-frontend"]), `${renderer.version} in ${frontend.engines["@antelopejs/dms-frontend"]}`),
        check("this version is inside the range the installation docs show", semver.satisfies(manifest.version, range), `${manifest.version} in ${range}`),
        same("the README table lists each interface dependency", interfaces.filter((name) => !table.includes(`\`${name}\``)), []),
        check("the docs name the module's package", installation.includes('package: "@antelopejs/dms-api"'), range),
      ]);
      await ctx.verify("the skill", [
        check("the frontmatter names dms-api", /^---\nname: dms-api\n/.test(skill), skill.slice(0, 40)),
        check("it names the three automation nodes", ["api.route-unhealthy", "api.get-api-health", "api.query-request-logs"].every((node) => skill.includes(node)), "nodes"),
        check("the cases file is version 1, its ids are unique and the skill is expected by the cases that name it", cases.version === 1 && cases.cases.length > 0 && new Set(cases.cases.map((/** @type {{ id: string }} */ entry) => entry.id)).size === cases.cases.length && cases.cases.some((/** @type {{ expect: { skills: string[] } }} */ entry) => entry.expect.skills.includes("dms-api")), cases.cases.length),
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
      const text = files.map((file) => read(ctx, `docs/${file}`)).join("\n");
      const linked = [...text.matchAll(/\/docs\/modules\/api\/([a-z/-]+)/g)].map((match) => match[1]);
      const unknown = linked.filter((target) => !pages.includes(target ?? ""));
      const keysOf = (/** @type {unknown} */ value, prefix = "") =>
        typeof value === "object" && value !== null ? Object.entries(value).flatMap(([key, inner]) => keysOf(inner, `${prefix}${key}.`)) : [prefix];
      const english = keysOf(JSON.parse(read(ctx, "frontend-vue/i18n/locales/api-en-GB.json"))).sort();
      const french = keysOf(JSON.parse(read(ctx, "frontend-vue/i18n/locales/api-fr-FR.json"))).sort();
      await ctx.verify("links", [
        same("every page exists", files.filter((file) => !existsSync(join(ctx.state.repo, "docs", file))), []),
        same("no console link points at a missing page", unknown, []),
        check("the README links every page", pages.every((page) => read(ctx, "README.md").includes(`/docs/modules/api/${page}`) || page === "usage/request-logs" || page === "usage/routes" || page === "usage/settings"), pages.length),
        same("the navigation names the section", read(ctx, "docs/.navigation.yml").includes("title: API"), true),
      ]);
      await ctx.verify("locales", [
        same("French lacks no English key", english.filter((key) => !french.includes(key)), []),
        same("English lacks no French key", french.filter((key) => !english.includes(key)), []),
      ]);
    },
  },
]);
