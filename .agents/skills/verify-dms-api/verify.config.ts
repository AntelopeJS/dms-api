/** A kind of one-way door. */
export type DoorKind = "data" | "format" | "contract" | "outbound" | "exposure" | "publish";

/** Path rules for one door kind: globs, declared funnel modules, and the journeys, as `feature/journey`, that contain it. */
export interface DoorRule {
  globs: string[];
  funnels: string[];
  containments: string[];
  why: string;
}

/** The repo-owned layer of the verification skill, read by `dms-control`. */
export interface VerifyConfig {
  playground: string;
  prepare: string[][];
  userFacing: string[];
  notUserFacing: string[];
  smoke: string;
  smokeJourney: string;
  doors: Record<DoorKind, DoorRule | null>;
  formal: never[];
}

const SKILL = ".agents/skills/verify-dms-api";

const config: VerifyConfig = {
  playground: `${SKILL}/playground`,
  prepare: [
    ["pnpm", "install", "--frozen-lockfile", "--prefer-offline", "--ignore-scripts"],
    ["pnpm", "run", "build"],
    ["npm", "install", "--no-save", "--no-package-lock", "--no-audit", "--no-fund", "--prefix", SKILL, "playwright-core@1.56.1", "mongodb-memory-server-core@11.0.1"],
    ["pnpm", "--dir", "playground", "install", "--ignore-workspace", "--frozen-lockfile", "--prefer-offline", "--ignore-scripts"],
    ["node", `${SKILL}/fetch-api.mjs`],
    ["ln", "-sfn", "../../../../playground/node_modules", `${SKILL}/playground/node_modules`],
    ["node_modules/.bin/tsc", "-p", `${SKILL}/playground/tsconfig.build.json`],
  ],
  userFacing: ["src/**", "frontend-vue/**", "skills/**", "package.json"],
  notUserFacing: ["frontend-vue/tests/**", "frontend-vue/.*", "frontend-vue/eslint.config.mjs", "frontend-vue/vitest.config.ts", "frontend-vue/pnpm-lock.yaml"],
  smoke: "smoke",
  smokeJourney: "onboard, call the fixture routes, read the Overview and the request logs",
  doors: {
    data: {
      globs: ["src/services/request-log/prune.ts", "src/services/statistics-prune.ts", "src/db/models/request_log.model.ts", "src/db/models/routes_statistics.model.ts", "src/index.ts"],
      funnels: [],
      containments: ["retention/the-hourly-prune-deletes-what-the-retention-passed"],
      why: "the hourly prune deletes stored request logs and per-day statistics, which a revert of the code does not bring back",
    },
    format: {
      globs: ["src/db/tables/**", "src/db/models/**", "src/services/statistics-write.ts", "src/services/request-log/capture.ts"],
      funnels: [],
      containments: [],
      why: "the tables, the statistics keys and the stored log shape are read back by the next version of the module",
    },
    contract: {
      globs: ["package.json", "src/routes/**", "src/config.ts", "frontend-vue/package.json", "frontend-vue/dms.frontend.ts", "skills/**"],
      funnels: [],
      containments: [],
      why: "the dashboard and scripts call the HTTP routes, projects set the config keys and the renderer range, and agents read the skill",
    },
    outbound: {
      globs: ["frontend-vue/server/tester.ts", "frontend-vue/dms.server.ts", "src/routes/tester.ts", "src/services/tester-source.ts"],
      funnels: [],
      containments: [],
      why: "the Tester sends real requests, with the owner's session when asked, to the project's API",
    },
    exposure: {
      globs: ["src/services/request-log/redaction.ts", "src/services/request-log/capture.ts", "src/services/request-log/access.ts", "src/services/request-log/console-traffic.ts", "src/guards.ts"],
      funnels: [],
      containments: [],
      why: "what is stored of every request, what is redacted before storage and who may read it back",
    },
    publish: {
      globs: ["package.json", ".release-it.json", "changelogen.config.json", ".github/workflows/release.yml"],
      funnels: [],
      containments: [],
      why: "the package name, its files and the release workflow claim @antelopejs/dms-api in the npm registry",
    },
  },
  formal: [],
};

export default config;
