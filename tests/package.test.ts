import { satisfies } from "semver";
import { beforeAll, describe, expect, it } from "vitest";
import journeysConfig from "../e2e/journeys.config";
import {
  exists,
  installedVersion,
  journeyFeatures,
  localeKeys,
  manifest,
  packedFiles,
  readText,
  rendererRange,
  skillCases,
} from "./helpers/package";

describe("the packed tarball", () => {
  let files: string[] = [];

  beforeAll(() => {
    files = packedFiles();
  }, 120_000);

  it("holds the built entry, the frontend module, the Vue layer and the skill the manifest names", () => {
    const { main, dmsFrontend, antelopeJs } = manifest();

    expect(main).toBe("dist/index.js");
    expect(dmsFrontend).toBe("dist/frontend-module.js");
    expect(antelopeJs.skills).toEqual(["./skills"]);
    expect(files).toEqual(
      expect.arrayContaining([
        "dist/index.js",
        "dist/frontend-module.js",
        "frontend-vue/dms.frontend.ts",
        "frontend-vue/package.json",
        "skills/dms-api/SKILL.md",
        "skills/dms-api/cases.json",
      ]),
    );
  });

  it("holds nothing outside dist, the Vue layer and the skill but the manifest, licence and readme", () => {
    expect(
      files
        .filter((path) => !/^(dist|frontend-vue|skills)\//.test(path))
        .sort(),
    ).toEqual(["LICENSE", "README.md", "package.json"]);
    expect(files.filter((path) => path.includes("node_modules/"))).toEqual([]);
  });
});

describe("the ranges the docs name", () => {
  it("admit the renderer the Vue layer is built against", () => {
    expect(
      satisfies(installedVersion("@antelopejs/dms-frontend"), rendererRange()),
    ).toBe(true);
  });

  it("admit this version in the installation docs", () => {
    const installation = readText("docs/2.installation.md");
    const range = /version: "([^"]+)"/.exec(installation)?.[1] ?? "";

    expect(installation).toContain('package: "@antelopejs/dms-api"');
    expect(satisfies(manifest().version, range)).toBe(true);
  });

  it("list every interface the module depends on in the README table", () => {
    const readme = readText("README.md");
    const table = readme.slice(
      readme.indexOf("antelopejs-docs-compat:start"),
      readme.indexOf("antelopejs-docs-compat:end"),
    );
    const { dependencies, optionalDependencies } = manifest();
    const interfaces = [
      ...Object.keys(dependencies),
      ...Object.keys(optionalDependencies),
    ].filter((name) => name.startsWith("@antelopejs/interface-"));

    expect(interfaces.length).toBeGreaterThan(0);
    expect(interfaces.filter((name) => !table.includes(`\`${name}\``))).toEqual(
      [],
    );
  });
});

describe("the skill", () => {
  it("is named dms-api and names its automation triggers and its write", () => {
    const skill = readText("skills/dms-api/SKILL.md");

    expect(skill.startsWith("---\nname: dms-api\n")).toBe(true);
    for (const node of [
      "api.route-unhealthy",
      "api.health-changed",
      "api.route-recovered",
      "api.request-captured",
      "api.route-registered",
      "api.get-api-health",
      "api.query-request-logs",
      "api.call-route",
    ]) {
      expect(skill).toContain(node);
    }
  });

  it("has version 1 cases with unique ids, some expecting the skill", () => {
    const { version, cases } = skillCases();

    expect(version).toBe(1);
    expect(cases.length).toBeGreaterThan(0);
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(cases.length);
    expect(cases.some((entry) => entry.expect.skills.includes("dms-api"))).toBe(
      true,
    );
  });
});

describe("the docs and the locales", () => {
  const pages = new Map([
    ["introduction", "1.introduction.md"],
    ["installation", "2.installation.md"],
    ["configuration", "3.configuration.md"],
    ["extending", "5.extending.md"],
    ["faq", "6.faq.md"],
    ["usage/overview", "4.usage/1.overview.md"],
    ["usage/request-logs", "4.usage/2.request-logs.md"],
    ["usage/routes", "4.usage/3.routes.md"],
    ["usage/settings", "4.usage/4.settings.md"],
  ]);

  it("link only console pages that exist", () => {
    const files = [...pages.values()].map((file) => `docs/${file}`);
    const docs = files.map(readText).join("\n");
    const targets = [...docs.matchAll(/\/docs\/modules\/api\/([a-z/-]+)/g)].map(
      (match) => match[1] ?? "",
    );

    expect(files.filter((file) => !exists(file))).toEqual([]);
    expect(targets.filter((target) => !pages.has(target))).toEqual([]);
    expect(readText("README.md")).toContain(
      "https://dms.antelopejs.com/docs/modules/api",
    );
    expect(readText("docs/.navigation.yml")).toContain("title: API");
  });

  it("hold the same keys in English and French", () => {
    const english = localeKeys("api-en-GB.json").sort();

    expect(english.length).toBeGreaterThan(50);
    expect(localeKeys("api-fr-FR.json").sort()).toEqual(english);
  });
});

describe("the e2e journeys", () => {
  it("export a journeys list per feature, and journeys for the smoke feature", async () => {
    const features = await journeyFeatures();

    expect(features.get(journeysConfig.smoke)?.length).toBeGreaterThan(0);
  });
});
