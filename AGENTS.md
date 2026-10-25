# dms-api

## Layout

| Path            | What it is                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `src`, `tests`  | `@antelopejs/dms-api`, the back-end DMS module, and its Vitest suite                                    |
| `frontend-vue`  | The Vue layer, shipped as source and built by the DMS loader. ESLint and Prettier own it, not oxlint and oxfmt |
| `playground`    | An AntelopeJS project that runs the module against MongoDB. It is not a workspace package: install it with `--ignore-workspace` |
| `skills`        | Agent skills published with the package                                                                 |

`frontend-vue` keeps its own lockfile (`shared-workspace-lockfile=false` in `.npmrc`). The root `pnpm install` installs it.

## Versioning

- `antelopejs-check-interface-ranges` (part of `pnpm lint`) checks the `@antelopejs/interface-*` dependency ranges.
- `frontend-vue/package.json` pins the `@antelopejs/dms-frontend` minor it builds against in `engines`. Move it together with the `@antelopejs/dms`, `@antelopejs/interface-dms` and `@antelopejs/dms-frontend` versions in `playground/package.json` and the compatibility table in `README.md`.
- The root package publishes CommonJS from `dist`. Do not add `"type": "module"` to it.

## What `pnpm run checks` does not run

- The build. CI runs `pnpm build` after the checks, and so does `prepack`.
- `pnpm --dir frontend-vue typecheck`. It needs a running DMS backend, so that `ajs dms prepare` can generate the Inertia workspace. Set `DMS_FRONTEND_WORKSPACE` to that workspace.
- The playground's typecheck and build (oxlint still lints it). Run `.agents/playground`, then `pnpm dev`.
- Unused files and exports. `pnpm knip` checks dependencies only. `pnpm knip:all` also reports dead files and exports, and expects findings: confirm each one before you remove it.

## Orb

`.agents/setup` belongs to the guardrail pack. `.agents/playground` installs the AntelopeJS CLI and MongoDB and builds the playground. The `dms-backend` service runs it before it starts.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

Finish every change with `pnpm run checks`. It runs typecheck, lint, format, knip, tests, size, ratchet, and sync, and prints only what failed. The change is done when it prints no failure.

The tools enforce most rules, listed in the table at the end. The sections below hold the rules no tool checks.

### Comments

Say it in code. A constraint belongs in a type, a lint rule, or a test. A public item's contract belongs in TSDoc (`/** */`) on that item. The only other comments are lint directives that name their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, `/*!` license headers, and bundler or formatter directives.

### Tests

Hold every test you write or keep to this checklist:

- Name the wrong implementation this test fails on. A test with no answer is deleted, not kept.
- No test reads the file it tests. Drive the behaviour through the public interface.
- An invariant over many files is a lint rule, not a test.

### Debt

`guardrails.ratchet.json` records the lint findings and oversize files this repository already had. Its numbers only go down. After you remove debt, run `pnpm run ratchet:update` and commit the lowered file. A rule listed there is off for `oxlint`. The ratchet counts it instead, and the pre-commit hook rejects it on every line you add.

### What enforces what

| Rule                                                                           | Enforced by                               |
| ------------------------------------------------------------------------------ | ----------------------------------------- |
| Formatting                                                                     | oxfmt                                     |
| Lint findings are errors; no rule warns                                        | oxlint preset                             |
| Comments are TSDoc, directives, or `SAFETY:` only                              | `antelopejs/no-comments`                  |
| Every test asserts                                                             | `antelopejs/require-assertion`            |
| Tests read no files outside fixtures, helpers, locales                         | `antelopejs/no-fs-read-in-tests`          |
| No assertion that restates a constant                                          | `antelopejs/no-constant-value-assertion`  |
| No test whose only check is "is a function"                                    | `antelopejs/no-typeof-function-only-test` |
| Params ≤ 5, function ≤ 120 lines, file ≤ 500 lines, depth ≤ 4, complexity ≤ 20 | `eslint/max-*`, `eslint/complexity`       |
| Files ≤ 20,000 bytes, tests included                                           | `antelopejs-check-size` (pre-commit)      |
| Existing debt only shrinks                                                     | `antelopejs-ratchet`                      |
| Types check                                                                    | `tsc` (pre-push)                          |
| No dead files, exports, or dependencies                                        | knip                                      |
| Managed files match the pack                                                   | `antelopejs-sync --check`                 |
| A test names the wrong implementation it catches                               | review; no tool                           |

<!-- antelopejs-guardrails:end -->
