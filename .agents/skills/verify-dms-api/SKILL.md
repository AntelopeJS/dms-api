---
name: verify-dms-api
description: "Drive the AntelopeJS dms-api module (the API console: health verdict, request logs, routes with their statistics and inferred documentation, the tester, and the settings) the way the platform owner does, inside a DMS with free ports and its own MongoDB database, and post a verdict with evidence. Use to prove a change to AntelopeJS/dms-api works before merge, to verify a PR, or to check that a seeded break or a seeded one-way door is caught."
---

# Verify dms-api

Every deterministic step is a `dms-control` command. You choose which journeys to run and judge what they show; you never write a multi-step shell recipe. When a journey you need does not exist, add it to `journeys/<feature>.mjs`, describe it in its feature file, and run it.

`dms-control` is the bin of `@antelopejs/dms`, a devDependency of this package. Run it with Node 24 after `pnpm install`:

```bash
C="pnpm exec dms-control"
$C                       # lists every command
```

Give `seeded`, `doors` and `--skill` absolute paths.

## Launch

```bash
RUN=$($C up --prepare --skill "$PWD/.agents/skills/verify-dms-api" --base origin/campaign/integration)
```

`--prepare` runs the `prepare` commands of `verify.config.ts`: the frozen install, the build of the module, `playwright-core` and `mongodb-memory-server-core` into this folder, the playground's install, `fetch-api.mjs` and the TypeScript build of the fixture module. Without it `up` uses the builds already there. `up` starts an isolated DMS from the playground in `playground/`: the DMS, the api, MongoDB, auth, local file storage and mail modules, the module under verification as a `local` source at the checkout, and a fixture module `app`.

- The checkout is laid out again under `$RUN/root`, every sibling linked, and the playground copied without `node_modules`, so the run's build, `.antelope/` and stored files are its own. The playground names the checkout's real folder as the module's source, because the module's `@/` import alias applies to files under the folder the source names.
- The API, the dashboard and the mail sink get free ports from the kernel; a `mongod` the run owns serves `verify_<run>` databases.
- The api module is a copy of the published `@antelopejs/api` patched by `fetch-api.mjs` to build route handlers with `controller` as well as `proto` (known finding, dms-api#101). The `up` of a run needs the npm registry once, for the dashboard's dependencies.

The fixture module (`playground/src`) serves what a journey cannot do over the console's own routes. `/fx/*` are the project's routes that traffic goes to: `ok`, `slow?ms=`, `boom` (throws), `missing` (404), `echo` (POST, 201), `login` (a token in the answer), `blob`, `items/:id` (GET, PUT, DELETE), `guarded/secret` (behind `auth_check`), `named/page` (behind `checkTicket`), `inline/private` (checks inside), `orders/:shop/lines` (path, query, header and body parameters). `POST /verify-api/member` makes a member whose role holds exactly the permission ids given.

## Doctor

```bash
$C doctor "$RUN"          # prints only failing checks; --verbose prints all
```

Do not drive a run that fails doctor. Its module checks look at this skill folder, not the module (known gap, reported against `dms-control`: the module root is taken from the playground's parent folder), so check that `dist/` is newer than `src/` yourself with `--prepare`.

## Drive

```bash
$C map                                   # every user-facing file is covered by a feature
$C plan --base origin/campaign/integration
$C journey "$RUN" smoke
$C journey "$RUN" overview [journey-id...]
```

- Each feature file in [features/](features/README.md) lists its source globs (`covers:`), its docs pages (`docs:`) and its journeys; the journeys are in `journeys/<feature>.mjs`, with the helpers they share in `api.mjs` (requests, checks, traffic, settings, members), `seed.mjs` (aged rows written to the run's MongoDB, which the module cannot be made to age), `guard.mjs` (environment loss) and `clock.cjs` (the backend's clock set ahead, so the hourly prune fires within seconds). [coverage/](coverage) holds one table per feature: every documented behaviour, its catching journey and check, or `Not driven` with the reason.
- A journey starts on an empty database with the administrator onboarded and the backend restarted on it. It reads every mutation back through a second view: the API, a reload, the stored documents, or a backend restart.
- Statistics and health are written behind the response: journeys wait with `settled` before reading them.
- `withConfig(ctx, { statisticsLifetime: … }, body)` restarts the backend with module options set and restarts it again without them.
- To look at the product yourself: `$C onboard "$RUN"`, `$C browser "$RUN" login`, `goto --path`, `snapshot`, `click --role --name`, `fill`, `press`, `screenshot`, `$C api "$RUN" <method> <path> [--as anon] [--body <json>]`, `$C reset "$RUN"`. Each writes its evidence under `$RUN/evidence/`.

## Evidence

Everything goes under `$RUN/evidence/`: `<feature>/<journey>/NN-<step>/` with `action.json`, `url.txt`, `aria.yml` and `screenshot.png` for a browser step, `request.json` and `response.json` for a request, and `checks.json` for every step that checks something; `<feature>/<journey>/result.json` and `<feature>/feature.json`. Read the evidence before you judge a PASS: a check passing proves only what it asserts. Page text checks run on the rendered text, where headings are in capitals.

## Cleanup

```bash
$C down "$RUN"
```

## Verdict rules

1. **Run every feature whose `covers:` globs the diff touches, plus the smoke journey.** `plan` prints that list as `run`.
2. **Unmapped surface fails the verdict.** User-facing code is `src/**`, `frontend-vue/**`, `skills/**` and `package.json`, tests and tool configs excluded (`verify.config.ts`). `map` checks the whole tree.
3. **Every registered journey of a feature in `run` must have run and passed.**
4. **Docs.** Judge every `docs:` page of each touched feature against what the journeys showed.
5. **Formal checks.** None.
6. **One-way doors.** The section comes right after the result line and is mandatory. `$C doors` prints the `One-way-door:` line for the diff. A Data door is contained by `settings/the-hourly-prune-deletes-what-the-retention-passed` passing in this run; no journey contains a Format door, so a Format row says so.
7. **Result.** FAIL if any of rules 1 to 6 fail. PASS+NOTES when something is not verified or needs the owner's attention. PASS otherwise.

Write `$RUN/evidence/judgement.json` (`doors`, `docs`, `notVerified`, `attention`, `verifier`), then `$C verdict "$RUN" --pr <n>` and, from a thread that did not write the change, `$C publish "$RUN" --pr <n>`.

## Trust

The skill is not Trusted yet. It becomes Trusted when it catches every seeded break and flags every seeded door, passes a shadow run of 10 consecutive agent PRs, and its last maintain pass is newer than the last change to the repository or its `@antelopejs` dependencies and at most 30 days old.

## Seeded breaks and doors

```bash
$C seeded smoke capture overview logs routes tester settings access package
$C doors "$PWD/.agents/skills/verify-dms-api/seeded-doors/data.patch"
```

`seeded-breaks/<feature>.patch` is one minimal product bug per feature; `seeded` builds a control and a patched worktree, runs the feature's journeys in each, and prints `CAUGHT` with the journeys that caught it, or `MISSED`. `seeded-doors/<kind>.patch` holds one change per door kind.

## Gotchas

- Every dashboard page renders on the server and hydrates after `load`; `tab.signIn` waits for the sign-in form to hydrate.
- The Routes page keeps its tree and filters behind the button that names the open route; the journeys open it before they filter.
- `mongod` comes from `DMS_CONTROL_MONGOD`, `PATH`, or the mongodb-memory-server cache (`~/.cache/mongodb-binaries`); a verifier with a bare environment passes `DMS_CONTROL_MONGOD` along.
- Known findings:
  - `GET /api/monitoring/routes/list` answers 500 against the published `@antelopejs/api`, which builds `proto` route handlers while the module reads `controller` (dms-api#101); the fixture patches a copy of the package, so no journey fails on it;
  - `settings/a-log-retention-of-no-day-is-refused-at-start` fails: `requestLogRetention: 0` starts the module, the form shows 1 day, and the hourly prune uses a cutoff of now (dms-api#103);
  - `access/a-role-opens-the-blocks-it-holds-and-no-others` fails: the docs say a role can hold one block of the console, but the DMS grants module-scoped permissions to the owner only (dms-api#104);
  - the docs read J as previous and K as next in the request drawer, the drawer steps the other way (dms-api#102; the journey asserts the behaviour the page announces);
  - the docs and the Tester tab name the header `x-dms-api-source`, the code sends `x-antelopejs-api-source` (docs mismatch, pinned in coverage/tester.md).
- The host's time zone must be a real one: with `TZ` unknown the dashboard pages answer 500 "Invalid time zone specified". Run with `TZ=UTC` (and `--pass-env TZ` for the agent-skills eval).
- `npm pack` ships `frontend-vue/tests/**` with the Vue layer (the `files` entry is the whole folder); the package journeys do not forbid it.

## Not driven

List these under `notVerified` in the judgement of every verdict. The per-feature reasons are in [coverage/](coverage).

- Copy, Copy cURL and Copy the URL buttons: they write to the clipboard.
- The automation nodes `api.route-unhealthy`, `api.get-api-health` and `api.query-request-logs`: the playground does not load `@antelopejs/dms-automation`.
- A second instance behind one console sharing `testerSourceSecret`: the run has one backend.
- Pointer drag of the drawer's edge and the persisted drawer width.
- Keyboard shortcuts `L`, `/` and `?`, the Tester's History, Headers for all routes and the form's editors, and a Tester call's forwarding limits.

## Feature map

[features/README.md](features/README.md).
