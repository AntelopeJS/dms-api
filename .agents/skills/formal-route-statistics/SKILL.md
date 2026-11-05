---
name: formal-route-statistics
description: TLA+ model of the per-route statistics rollup of @antelopejs/dms-api (the routes_statistics row that addRequestStatistics on every replica and the hourly pruneAllStatistics both rewrite, with openBatches, the revision-guarded replaceStatistics, the duplicate-key insert and the retry loop), checked with TLC. Use when a change touches src/services/statistics-write.ts, src/services/statistics-prune.ts, src/db/models/routes_statistics.model.ts, the statistics call in src/services/request-log/capture.ts or the prune cron in src/index.ts, or needs proof that no request is counted twice or lost by another writer.
---

# Formal check: the per-route statistics rollup

Every replica of `@antelopejs/dms-api` folds each matched request into one `routes_statistics` row per route: a read, then an insert of a new row or a replace of its `statistics` array guarded by the row's `revision`, retried from a fresh read when another writer got there first. A replica writes one batch of a route at a time (`openBatches`, `lastWrites`). The hourly prune of every replica rewrites the same row without the days below its cutoff, under the same guard. The Overview, the Routes page and the health verdict read these counts.

The model treats each database call as one step: a read, or the database applying or refusing one insert or one guarded replace. The answer reaches the caller in a later step, or is lost: the caller then sees `"unknown"` (an error for an insert), and the call may still apply later, or never. TLC checks every order of those steps across two replicas, the prunes, one lost answer and a day rollover, within the bounds below.

- `RouteStatistics.tla` holds the variables, the actions and the rules. Each condition carries a `file.ts:NN` comment; the files are under `src/`.
- `OnePrune.cfg` (one prune) and `TwoPrunes.cfg` (the prunes of both replicas' crons) are the full configurations. Each has a `.ci.cfg` twin, the CI configuration.
- `RouteStatistics.map.mjs` and `chart-conflict.cfg`, `chart-unknown.cfg`, `chart-prune.cfg` are for reading results with `/statechart`.

## Run it

From the repository root, with Node 24 and `pnpm install` done (the runner comes from `@antelopejs/tooling-configs/formal`):

```sh
node .agents/skills/formal-route-statistics/check.mjs          # CI configuration
node .agents/skills/formal-route-statistics/check.mjs --full   # full configuration
```

Java 11 or later comes from `$JAVA`, else `java` on PATH, else the `eclipse-temurin:21-jre` Docker image (set `TLC_DOCKER_PREFIX` to name the containers). The first run downloads TLC 1.7.4 into `~/.cache/antelopejs-formal` (or `$XDG_CACHE_HOME/antelopejs-formal`) and checks its SHA-256. Each run checks one prune first, then two.

| Configuration | Requests (one prune, two prunes) | States (one prune, two prunes) | Wall time |
| --- | --- | --- | --- |
| CI (`<config>.ci.cfg`) | 2, 1 | 31,246, 8,272 | 4.4 s |
| Full (`<config>.cfg`) | 3, 2 | 499,636, 348,531 | 16.5 s |

Every configuration runs two replicas, days 0 to 2 with a retention of one day, `MAX_STATISTICS_WRITE_ATTEMPTS` of 10 and one lost answer. The times are runs in Docker Java 21 on a shared 16-core machine with a load average near 35; container and JVM start-up take about 2 s of each of the four TLC runs.

- Exit 0 means every rule still holds.
- Exit 1 means a rule changed. `BROKEN` names a rule that held and now breaks, followed by TLC's counterexample as its action names. The script keeps TLC's output in a temporary folder and prints its path. The run stops at the first configuration that changed, so a change with one prune skips the run with two.
- Exit 2 means TLC or Java could not run, or the arguments were wrong.

The lines that name a changed rule match `^(?:BROKEN|CHANGED|HOLDS) +(\w+)`. A rule that still holds prints as lowercase `holds`. No rule has a recorded finding, so `CHANGED` and `HOLDS` appear only once one is recorded. TLC runs the holding rules on every core, so the counterexample after `BROKEN` can differ between runs; the rule it names does not.

## When to run it

Run `--full` when a change touches a file in the coverage record below, or this folder. CI runs the CI configuration on every push (job `formal-route-statistics`, in the `ubuntu` gate). The `verify-dms-api` skill lists this check in its `verify.config.ts`, so `dms-control formal` runs the full configuration on a verdict whose diff touches a covered file or this folder.

## The rules

| Rule | Plain sentence | Harm when it breaks | Every configuration |
| --- | --- | --- | --- |
| `AtMostOnce` | A request is counted at most once. | The route's calls, errors and latency figures overstate its traffic. | holds |
| `ResolvedCountedOnce` | A request whose write resolved on a definite answer is counted exactly once, unless its day has fallen below the cutoff. | A request the code reports as written is missing from the console. | holds |
| `PruneKeepsRetainedDays` | A prune never removes a day at or above its cutoff. | Days inside the retention window vanish from the route's history, and a revert does not bring them back. | holds |
| `NoErasedCounts` | No write lowers a count that a prune may not drop: one writer never erases another's requests. | Requests counted by one replica vanish when another replica or the prune writes back a stale array. | holds |

`TypeOK` holds too. A definite answer is an `"applied"` replace, or an insert that stored the row. The only other answer that resolves a write is `"unknown"` (statistics-write.ts:187, 192). A write that resolves on `"unknown"` or gives up only undercounts, which the code accepts (statistics-write.ts:170-176).

## No finding at the sync commit

Every rule holds in every configuration. The code earns it in three places: the revision guard refuses a replace built from a row that another writer changed since the read; the writer returns on `"unknown"` instead of retrying; and a batch closes as its write starts, so a request never joins a write that has already read the row. The scratch breaks below remove each of these in turn, and TLC and a replay on the real code both catch them.

## Read every result with /statechart

Read each TLC result with the pstack `/statechart` skill. Work on a copy of `RouteStatistics.tla`, the map and the chart configs in a scratch folder outside the repo, since it writes its output next to its input. Use `RouteStatistics.map.mjs` as the view: one region for the row, one per request and one per prune. Each chart config is small enough for the whole graph, and every rule holds in each:

- `chart-conflict.cfg` (two replicas, two requests, no prune, no lost answer) reaches 404 states and draws 21 states and 31 arrows: two writes read the same row, one is refused and retries from a fresh read.
- `chart-unknown.cfg` (two replicas, one request, one lost answer) reaches 36 states and draws 10 states and 10 arrows: the answer is lost, the write returns, and the lost write applies late or is refused.
- `chart-prune.cfg` (one replica, one request, one prune, a retention of zero days so that one midnight expires the oldest day) reaches 350 states and draws 30 states and 52 arrows.

The view hides `Settled`, the step that changes nothing once nothing else can happen. A new bug shows as a numbered path: on the `retry-after-unknown` break below, `chart-unknown.cfg` draws `AtMostOnce` in 7 steps, ending with the request counted 2 times.

## Real bug or modeling error

Node runs other callbacks at every `await`, so database answers, other replicas' writes, the prune and midnight can interleave in any order the model allows. A database call applies at one instant, so a read and the write it leads to are two steps with any other step between them. A step order is a modeling error when the code cannot produce it, for example two writes of one route in flight on one replica, or a batch that gains a request after its write started.

Replay a counterexample against the real code before you trust it. The replays of the breaks below were a scratch Vitest file under `tests/`, not committed. It loads two copies of `src/services/statistics-write.ts` through `vi.resetModules()`, one per replica, and `pruneAllStatistics` with `setConfig({ statisticsLifetime: MS_PER_DAY })`. It hands each a fake store whose every call waits until the replay applies it at a fake database, delivers its answer, or loses it, keeping a lost call to apply later. The fake applies a replace through the real `statisticsMutation` and checks its expected revision, and fails an insert on a stored row with `E11000 duplicate key error`. It fakes `Date` only, and moves it a day at each `Tick`. Each request has its own response time (1, 10 or 100 ms, and 1000 for the request counted before the run), so a day's `totalResponseTime` says which requests it counts, and how many times. One replay step per TLC action; assert only what the console reads: the counts in the row, and whether each request's promise resolved. If the replay does not reproduce a counterexample, treat the model as wrong until you show it is not.

## Changing the model

- For an intended code change, edit the action that maps to that code, keep the `file.ts:NN` comment on each condition and update its line, then run both configurations.
- Never weaken or drop a rule to make the check pass. A new finding goes into `CONFIGS` in `check.mjs` with its counterexample length for each configuration, once a replay confirms it, and into this file with its replay. A fixed finding leaves `CONFIGS` once a replay confirms the fix.
- When you change the bounds of a `.ci.cfg`, rerun the scratch changes below on it. The CI configuration must still catch each one.
- After you confirm that the model describes the code at a newer commit, move the sync commit forward. Do it only then.

## Coverage record

| Model action | Code |
| --- | --- |
| `Init` | the row missing, or stored with or without `revision` (routes_statistics.table.ts:50-56) |
| `Arrive` | the capture monitor records a matched request once (capture.ts:88-94, 394-401, 126-141); it joins the route's open batch or opens one (statistics-write.ts:226-238) |
| `WriteStart` | once the previous write settled, the batch closes and its write reads today's date (statistics-write.ts:233-236, 182) |
| `WriteRead` | `model.get`, then the insert of a new row or the replace of the row read with the batch folded in (statistics-write.ts:185-191, 98-110, 146-162) |
| `DbApply`, `OrphanApply` | the duplicate key on a stored row (statistics-write.ts:156-166); the revision guard and the fresh revision of `replaceStatistics` (routes_statistics.model.ts:14-24, 47-51) |
| `WriteAnswer` | a stored insert or `"applied"` resolves; a duplicate key or `"not-applied"` retries, up to `MAX_STATISTICS_WRITE_ATTEMPTS`, then throws (statistics-write.ts:183-196, 123) |
| `WriteLost` | `"unknown"` returns without a retry (statistics-write.ts:192); an insert's error is rethrown (line 166) |
| `Settle` | the write settles and the next batch may start (statistics-write.ts:239-246) |
| `PruneStart` | the cron runs `pruneAllStatistics` with today's cutoff (index.ts:68-71, statistics-prune.ts:51-55) |
| `PruneRead` | the first read, or the re-read after a conflict, and the guarded replace without the expired days (statistics-prune.ts:29-35, 38, 11-16) |
| `PruneAnswer`, `PruneLost` | `"applied"` and `"unknown"` end the route, `"not-applied"` retries (statistics-prune.ts:30, 36-40) |
| `Tick` | midnight passes (statistics-utils.ts:6-10) |

The sync commit is `84c20d5` on AntelopeJS/dms-api `feat/verify-dms-api-skill`, where the model was written and each break replayed. The covered files last changed in `15b0919` (statistics-write.ts), `8fabb0c` (statistics-prune.ts), `2c57c5d` (routes_statistics.model.ts, routes_statistics.table.ts), `a98822b` (statistics-utils.ts), `fc5ff81` (index.ts) and `9e5d129` (capture.ts).

## Bounds and what is left out

Every configuration runs two replicas, days 0 to 2 and a retention of one day, so the oldest day expires on day 2. `OnePrune` runs one prune at a time of TLC's choosing beside 2 requests (CI) or 3 (full); `TwoPrunes` runs one prune per replica's cron beside 1 request (CI) or 2 (full). One answer is lost per behaviour. A pass covers these bounds only.

The model leaves out:

- other routes: each route has its own row, batch and writes, and the prune treats each row on its own (statistics-prune.ts:58-62).
- the retry limit: within these bounds a write or a prune makes four attempts at most (a scratch invariant `attempt < 4` held in both full configurations), so neither reaches its tenth attempt and gives up. Giving up only undercounts.
- the retry delay (statistics-write.ts:133-139): a delay is time between steps, and TLC tries every order of steps anyway.
- a `get` or `getAll` that fails: the write or the prune rejects before it sends anything.
- an adapter that breaks the `atomicMutation` contract of `@antelopejs/interface-database`, by reusing a revision or by retrying a call whose answer it lost. An adapter that retried an insert after a lost answer and then reported a duplicate key would count that batch twice.
- the `day` a request lands on: a batch writes every request under its write's `today` (statistics-write.ts:182), so a request captured just before midnight can count on the next day. No rule here depends on it.
- replicas that disagree on today, through clock skew or time zones: the model has one clock.
- the cutoff in hours: it is local midnight minus `statisticsLifetime` in milliseconds (statistics-prune.ts:52-53), so for the 90 days after an autumn clock change the oldest day sits one hour below the cutoff and is dropped a day early (checked with `TZ=Europe/Paris`: on 2026-11-20 the day 90 days back is dropped, on 2026-07-20 it is kept). The model counts whole days.
- a third replica, more requests or more lost answers: no run here covers them.
- the request log, its own prune, and the pages that read the counts.

## Confirm the check can fail

On a scratch copy of this folder (with `node_modules` reachable, for example a symlink beside it), apply one model edit at a time and run `check.mjs` with and without `--full`. Each edit mirrors the code change in the first column. The same code change, applied to `src/` at the sync commit, made the replay of TLC's shortest counterexample fail with the outcome in the last column; with the change dropped, each replay passed, its path cut short where the code differs. Lengths are the states of TLC's shortest counterexample on `OnePrune.ci.cfg`, with one worker.

| Scratch change in the code, and the model edit | CI configuration | Full configuration | Replay on the broken code |
| --- | --- | --- | --- |
| `retry-after-unknown`: an `"unknown"` answer retries like `"not-applied"` (statistics-write.ts:192): `WriteLost` of a replace goes back to `WriteRead` | `BROKEN AtMostOnce` (8 states) | same | `a replace answer lost`, the lost replace applies, `a get`, `a replace -> "applied"`: r1 counted 2 times |
| `plain-update-writer`: the writer goes back to a plain `model.update` of the array, the code before `8fabb0c` (statistics-write.ts:191-192): a replace applies whenever the row exists | `BROKEN NoErasedCounts` (9 states) | same | both replicas read the row, `a update`, `b update`: b lowered r1 on day 0 from 1 to 0 |
| `plain-update-prune`: the prune writes with a plain `update` (statistics-prune.ts:35-36): a prune applies whenever the row exists | `BROKEN PruneKeepsRetainedDays` (10 states); `NoErasedCounts` breaks too | same | a reads on day 1, the prune reads on day 2, `a replace -> "applied"`, `q1 update`: day 1 dropped at its cutoff, r1 lowered from 1 to 0 |
| `prune-drops-the-cutoff-day`: `stat.day > cutoff` (statistics-prune.ts:15): `Expired(d, c) == d <= c` | `BROKEN PruneKeepsRetainedDays` (5 states) | same | on day 1 the prune drops day 0, its cutoff |
| `duplicate-key-returns`: a duplicate key resolves the write instead of retrying (statistics-write.ts:187-188): a refused insert settles `resolved` | `BROKEN ResolvedCountedOnce` (10 states) | same | both replicas insert, `b insert -> E11000 duplicate key error`: r2 resolved, not counted |
| `batch-stays-open`: the batch closes when its write ends, in a `finally` (statistics-write.ts:234-237): a request arriving during the write joins its batch | `BROKEN ResolvedCountedOnce` (7 states) | same | r2 arrives after a's insert was sent; the insert stores r1 only and both resolve: r2 not counted |

Every scratch run in the table exited 1. With the edits dropped, both configurations exit 0.
