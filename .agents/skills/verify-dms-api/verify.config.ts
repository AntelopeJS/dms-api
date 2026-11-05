/** A kind of one-way door. */
export type DoorKind = "data" | "format" | "contract" | "outbound" | "exposure" | "publish";

/** Path rules for one door kind: globs and declared funnel modules. */
export interface DoorRule {
  globs: string[];
  funnels: string[];
  why: string;
}

/**
 * How the gate decides whether a diff changed what the covered code does:
 * `emit` compares the JavaScript statements of the covered files on the
 * base and on HEAD (types, comments, formatting, imports and export
 * keywords left out); `probe` runs a command on a checkout of each, the
 * checkout's path as last argument, and compares what it prints.
 */
export type Behaviour = { kind: "emit" } | { kind: "probe"; command: string[] };

/**
 * A formal check: the source files it covers, the check's own files, the
 * command that runs it, how its output names a violated and a passing rule,
 * how the gate decides that a diff changed the covered behaviour, and the
 * command run on the base when it did or when the check's own files changed
 * (`command` when absent).
 */
export interface FormalCheck {
  name: string;
  covers: string[];
  files: string[];
  command: string[];
  baseCommand?: string[];
  violation: RegExp | null;
  passing: RegExp | null;
  behaviour: Behaviour;
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
  formal: FormalCheck[];
}

const SKILL = ".agents/skills/verify-dms-api";

const config: VerifyConfig = {
  playground: `${SKILL}/playground`,
  prepare: [
    ["pnpm", "install", "--frozen-lockfile", "--prefer-offline", "--ignore-scripts"],
    ["pnpm", "run", "build"],
    ["npm", "install", "--no-save", "--no-package-lock", "--no-audit", "--no-fund", "--prefix", SKILL, "playwright-core@1.56.1", "mongodb-memory-server-core@11.0.1"],
    ["pnpm", "--dir", "playground", "install", "--ignore-workspace", "--frozen-lockfile", "--prefer-offline", "--ignore-scripts"],
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
      why: "the hourly prune deletes stored request logs and per-day statistics, which a revert of the code does not bring back",
    },
    format: {
      globs: ["src/db/tables/**", "src/db/models/**", "src/services/statistics-write.ts", "src/services/request-log/capture.ts"],
      funnels: [],
      why: "the tables, the statistics keys and the stored log shape are read back by the next version of the module",
    },
    contract: {
      globs: ["package.json", "src/routes/**", "src/config.ts", "frontend-vue/package.json", "frontend-vue/dms.frontend.ts", "skills/**"],
      funnels: [],
      why: "the dashboard and scripts call the HTTP routes, projects set the config keys and the renderer range, and agents read the skill",
    },
    outbound: {
      globs: ["frontend-vue/server/tester.ts", "frontend-vue/dms.server.ts", "src/routes/tester.ts", "src/services/tester-source.ts"],
      funnels: [],
      why: "the Tester sends real requests, with the owner's session when asked, to the project's API",
    },
    exposure: {
      globs: ["src/services/request-log/redaction.ts", "src/services/request-log/capture.ts", "src/services/request-log/access.ts", "src/services/request-log/console-traffic.ts", "src/guards.ts"],
      funnels: [],
      why: "what is stored of every request, what is redacted before storage and who may read it back",
    },
    publish: {
      globs: ["package.json", ".release-it.json", "changelogen.config.json", ".github/workflows/release.yml"],
      funnels: [],
      why: "the package name, its files and the release workflow claim @antelopejs/dms-api in the npm registry",
    },
  },
  formal: [
    {
      name: "formal-route-statistics",
      covers: [
        "src/services/statistics-write.ts",
        "src/services/statistics-prune.ts",
        "src/services/statistics-utils.ts",
        "src/db/models/routes_statistics.model.ts",
        "src/db/tables/routes_statistics.table.ts",
        "src/services/request-log/capture.ts",
        "src/index.ts",
      ],
      files: [".agents/skills/formal-route-statistics/**"],
      command: ["node", ".agents/skills/formal-route-statistics/check.mjs", "--full"],
      baseCommand: ["node", ".agents/skills/formal-route-statistics/check.mjs"],
      violation: /^(?:finding|BROKEN|CHANGED|HOLDS) +(\w+)/gm,
      passing: /(?<=^holds +(?:\w+, )*)(\w+)(?=,| \()/gm,
      behaviour: { kind: "emit" },
    },
  ],
};

export default config;
