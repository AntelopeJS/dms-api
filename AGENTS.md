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

- The `dependency:ranges` step of `pnpm run checks` checks the `@antelopejs/*` dependency ranges.
- `frontend-vue/package.json` pins the `@antelopejs/dms-frontend` minor it builds against in `engines`. Move it together with the `@antelopejs/dms`, `@antelopejs/interface-dms` and `@antelopejs/dms-frontend` versions in `playground/package.json` and the compatibility table in `README.md`.
- The root package publishes CommonJS from `dist`. Do not add `"type": "module"` to it.

## What `pnpm run checks` does not run

- The build. CI runs `pnpm build` in its own job, beside the checks, and so does `prepack`.
- `pnpm --dir frontend-vue typecheck`. It needs a running DMS backend, so that `ajs dms prepare` can generate the Inertia workspace. Set `DMS_FRONTEND_WORKSPACE` to that workspace.
- The playground's typecheck and build (oxlint still lints it). Run `.agents/playground`, then `pnpm dev`.
- Unused files and exports. `pnpm knip` checks dependencies only. `pnpm knip:all` also reports dead files and exports, and expects findings: confirm each one before you remove it.

## Orb

`.agents/setup` belongs to the guardrail pack. `.agents/playground` installs the AntelopeJS CLI and MongoDB and builds the playground. The `dms-backend` service runs it before it starts.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

CI runs `pnpm run checks` in full on every pull request and reports what failed. The commit hook formats and lints the staged files. Locally, run only the fast check for what you touched:

- `pnpm run typecheck` after you change types or signatures.
- `pnpm exec oxlint <files>` and `pnpm exec oxfmt <files>` on the files you changed.
- One test file, not the suite. In a module that tests with `ajs module test`: `pnpm run build`, then `pnpm exec ajs module test . -f dist/<path>.test.js`.

Prove a change works with the verification skill in [`.agents/skills/verify-dms-api/SKILL.md`](.agents/skills/verify-dms-api/SKILL.md) before you call it done.

### Comments

Say it in code: a constraint in a type, a lint rule or a test, a public item's contract in TSDoc. Other comments are lint directives naming their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, and license or tool directives. A reason states what the code does now.

### Tests

Each test names the wrong implementation it fails on, or is deleted. Drive behaviour through the public interface. An invariant over many files is a lint rule.

### Review

No tool checks these:

- A type guard checks the nested elements and values it claims.
- A no-upward import rule rejects same-tier peers; probe it with an import.
- A finding only an evasion or a patched internal can trigger goes under Attention and never blocks.

### Suppressions

`guardrails.suppressions.json` caps lint directives, `@ts-expect-error`, `SAFETY:` comments and rules a lint config turns off. Over a cap, fix the code or remove another suppression of that kind; only the operator raises a number. After removing suppressions, run `pnpm run suppressions:update` and commit the file.

<!-- antelopejs-guardrails:end -->
