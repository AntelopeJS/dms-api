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
    data: null,
    format: null,
    contract: null,
    outbound: null,
    exposure: null,
    publish: null,
  },
  formal: [],
};

export default config;
