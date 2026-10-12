# dms-api redesign: grill-me session

> **Out of date since the QA pass of October 10, 2026.** The answers below
> are the plan as first taken; the QA pass and its fixes changed several of
> them. In short:
>
> - Dependencies: `@antelopejs/dms` `>=0.7.13 <0.8.0` (`interface-dms`
>   0.5.8) and `@antelopejs/dms-frontend` `>=0.5.2 <0.6.0`, not dms 0.6 /
>   interface-dms 0.4 / dms-frontend 0.5.0.
> - A request opens in the DMS row side panel (a `sidePanel` row action
>   target, dms 0.7.8) on a single click, from every request table: the DMS
>   draws its header ("Request 3 of 50 shown", ∧ ∨, J / K, close), highlights
>   the open row and keeps it in `?record=`.
> - The Overview, the Request logs and Routes declare the DMS page live mode
>   (`live: { maxRate, slowRateAfter, rememberKey: "api" }`) with its pill
>   `LiveToggle` (Live / Pause, "Paused · 40 new requests · 2 in 5xx"), over
>   the realtime topic the capture publishes on; the request tables hold their
>   rows while paused, while a row is open in the side panel and, in the
>   request logs, while scrolled, searched or sorted otherwise than newest
>   first (`liveHold`), their strip saying why and what came in ("40 new
>   requests · 2 in 5xx"); the Tester holds the page while you type in it
>   (`usePageLive().hold()`). The console's own blocks read again through the
>   same gate as the DMS blocks (`usePageLiveRefresh`), at the page's pace.
> - The column tones are the DMS's: a slow duration in orange
>   (`DurationDisplay({ format: "ms", toneField })`), an error in red
>   (`TextDisplay({ toneField })`).
> - The health is judged by explicit rules (error rates, latency, incidents,
>   recovery), shown with their thresholds and windows.
> - Periods are rolling, picked with the DMS `PeriodSelector` (24H by default,
>   1H to 30D), kept in the URL (`?api.period=last-24h`) and followed by the
>   request tables (`periodScope`); the console's own blocks read the period
>   the selector applies with `usePeriodScope`, and an incident link narrows
>   the request logs to its range with a linked filter (`?since=&until=`),
>   the page's period kept;
>   statistics are kept 30, 60 or 90 days (90 by default); the latency chart
>   shows the p95 instead of the minimum.
> - The snippets are written against the DMS's public API origin
>   (`GetApiBaseUrl()`, its `apiBaseUrl`); the module has no URL option of
>   its own. Figures, dates and times are written in the DMS's
>   `formatLocale` (`useRegionalFormat({ locale: "format" })`, `en-GB` for
>   `en`) with the user's Language & region preferences.
> - The console no longer captures its own traffic or the DMS's, and logs the
>   Tester's calls without counting them. Data stored by an earlier version
>   is not migrated: the tables are dropped on upgrade (see the README).
>
> The README is the reference for the current behaviour.

A self-answered grilling of the plan behind the dms-api redesign PR. Each
question is one branch of the decision tree; the answer is the recommendation
that was taken. Read it next to the diff: every structural choice in the PR
traces back to one of these answers.

Inputs:

- The request: bump every `@antelopejs` dependency, adapt to the breaking
  changes of `@antelopejs/dms` 0.6 / `@antelopejs/interface-dms` 0.4 and
  `@antelopejs/dms-frontend` 0.5, apply the new design (adding and removing
  features where it says so), reuse the DMS blocks before writing custom
  components, describe every page on the backend, give custom blocks an i18n
  `meta`, retest everything and fix the bugs found on the way.
- The design mockup, `modules/api/*` (Overview, Routes with Statistics /
  Documentation / Tester, Request logs with the request drawer, Settings,
  empty and error states) and its UX review (findings F01 to F17).
- The DMS docs shipped with 0.6, in particular *Migrate from 0.3 to 0.4*.

## 1. Scope

**Q1. What does the PR cover?**
Everything the mockup shows for the API module, the dependency bump and the
migration. The two "Design review" entries of the mockup sidebar (Empty &
error states, UX review) are design artefacts, not product pages: their
content lands inside the real pages (states) or in this document (review).

**Q2. Which findings of the UX review are in?**
All seventeen, with the adaptations listed below where the DMS blocks impose a
different shape. Findings that need a capability the DMS does not have are
named explicitly (Q30).

**Q3. One PR or several?**
One, as asked. The commits are split by concern (deps, backend, blocks,
pages, tests) so the history can be reviewed commit by commit.

## 2. Dependencies and breaking changes

**Q4. Which ranges?**

| Package | Before | After |
| --- | --- | --- |
| `@antelopejs/interface-dms` | `>=0.2.8 <1.0.0` | `>=0.4.0 <1.0.0` (the `antelopejs-check-interface-ranges` gate wants every release up to the next major; the DMS module is the one that caps it) |
| `@antelopejs/interface-api` | `>=0.0.13` | `>=0.0.14` |
| `@antelopejs/interface-dms-automation` (optional) | `>=0.1.0` | `>=0.1.1` |
| `@antelopejs/core` (dev, pinned) | `1.13.4` | `1.13.5` |
| frontend `engines["@antelopejs/dms-frontend"]` | `>=0.2.8 <0.4.0` | `>=0.5.0 <0.6.0` |
| playground `@antelopejs/dms` | `>=0.5.0` | `>=0.6.0 <0.7.0` |
| playground `@antelopejs/mongodb` / `api` | `^1.3.1` | `^1.4.2` / `^1.3.3` |

**Q5. What breaks on the backend?**
Only `TreeNode` (`interface-dms/base/tree` was removed). The tree type moves
into `src/services/tree.ts`, owned by the module.

**Q6. What breaks on the frontend?**
- dms-frontend 0.5 prefixes every registered name with the module's
  `componentPrefix` and auto-imports nothing without a
  `dms.frontend.build.ts`. The entry declares `componentPrefix: "DmsApi"`,
  registers bare file names, and a `dms.frontend.build.ts` declares
  `app/composables`; the utils are imported by path, so their names never
  compete with the DMS's own auto-imported helpers.
- The DMS `build/` components are private: nothing in the module imports or
  names them. Public ones (`DmsCard`, `DmsStatusSummary`, `DmsChart`,
  `DmsKpiCard`, `DmsEmptyState`, `DmsSegmented`, `DmsStatusPill`,
  `DmsCopyButton`, `DmsBanner`…) are used instead.

**Q7. What else from the migration guide applies?**
- *Edit bodies are partial, `null` clears a field*: the settings route merges
  the body into the stored document instead of replacing it.
- `StatStrip` became `StatGroup`, tones `ok`/`accent` became
  `success`/`primary`: only the new names are used.

## 3. Page composition

**Q8. One custom Vue component per page, as today, or a backend block tree?**
A backend block tree. Today every page is one `CustomComponent` rendering
the whole screen; the redesign describes each page as DMS blocks
(`PeriodSelector`, `Banner`, `ChartCard`, `TopListCard`, `ActivityFeed`,
`TableView.fromSource`, `Form` with sections, `Tab`, `Grid`, `HStack`) and
keeps custom components for the parts no block expresses.

**Q9. Which parts stay custom, and why?**

| Custom block | Why no DMS block fits |
| --- | --- |
| `ScopeChip` | A live "Own routes · 42" link to Settings; no block reads the scope. |
| `BetaBadge` | A "Beta" pill at the head of the toolbar with its meaning in a tooltip; no block draws a pill with a tooltip. |
| `HealthHero` | The verdict, since when (its start in a tooltip) and why, its four figures, the stale state when a refresh fails, a toast when the verdict changes and "● Degraded" in the browser tab, read from `/overview/health`. A `Banner` and a `StatGroup` give none of these. It reads again through `usePageLiveRefresh`, with an idle read each quiet minute. |
| `LiveTraffic` | Per-minute histogram of the last hour, its current minute hatched, that follows the page's Direct / Pause (`usePageLiveRefresh`) and shows its own failures ("reconnecting"); a `ChartCard` has neither. |
| `LogsFilters` | The method and slow filters of the request logs and the filters a link brought (route, path, error, an incident's range), each a removable chip, all kept in the URL (`queryParamFilters`); the DMS table neither shows the URL's filters nor lets a user remove one. |
| `LogsEmptyState` | The request table's empty states (`emptyStates.*.component`): it names what empties the table (search, a link's filters, the period, the other filters) with its way out, which the DMS cannot tell for filters it does not count. |
| `RequestDetail` | The body of the request side panel (error and stack first, timing, headers, bodies, Replay / cURL / Open route / Same error); the DMS draws the panel and its navigation, and the stack is a `DmsCodeSnippet`. |
| `RouteTree` | A filterable tree whose selection lives in the URL. |
| `RouteHeader`, `RouteDocumentation`, `RouteTester` | Everything under the selected route reads `?route=` from the URL. They render public DMS components (`DmsCard`, `DmsEmptyState`, `DmsStatusPill`) inside. Since DMS 0.6.1 a block's `fetchUrl` takes `{{query.route}}`, so the Statistics tab is now DMS blocks only (a `StatGroup` of the route's figures, `ChartCard`, `TopListCard`, a request table filtered by `?route=`), behind a DMS `Guard` that draws one empty state and a link to the Tester while the route has no call over the period; these three stay custom for what they draw, not for how they read the route. |
| `SplitLayout` | A list beside its detail. `Grid` shares its columns equally, so a row of two cells cannot give one of them three quarters; `DmsMasterDetail` is a template component, not a block. |
| `SettingNumberInput`, `RetentionInput` | Fields of the Settings `Form`. `SettingNumberInput` draws `DmsInputNumber` at the width of a number and writes its `adjust` event as a note ("1020 is not a step of 50: rounded to 1,000"); `RetentionInput` says what a lowered retention deletes, read from the server as the value changes, and asks to confirm on save, one dialog for both retentions, from a validator of the enclosing form (`useEnclosingForm`) that submits it again once confirmed. The DMS form has no confirmation on submit nor a field note computed from an unsaved value. The form itself follows a field's anchor (`#requestLogCaptureHeaders`), so the headers use its tags input. |

The request tables draw their cells with DMS displays: status pills toned
per method, or per row through `toneField` (a status by its class), the
duration in milliseconds toned `warning` when slow
(`DurationDisplay({ format: "ms", toneField: "durationTone" })`) and the error
message toned `error` (`TextDisplay({ toneField: "errorTone" })`), the tones
set by the server on each row. The module keeps two cell displays
(`@RegisterDisplay`): the time to the millisecond (`api:time`), and the path
in the mono font with a "Tester" badge on a request the Tester sent
(`api:path`), which the DMS mono display cannot add.

**Q10. How are custom blocks named for permissions?**
Every one carries `.meta({ name: "$api.blocks.<id>.name", description,
icon })`, translated in `en-GB` and `fr-FR`. Built-in blocks get the same
treatment where their default meta would read "TableView" or similar.

**Q11. Do these names show in the Roles editor?**
Not today, and it is worth knowing: pages declared with `module: "api"` are
module-scoped. The DMS keeps their permission ids out of the grantable Roles
tree and only the platform owner holds them (`IsModuleScopedPermission`,
*Distributable module → Module navigation and access*). The metas are still
written properly, so the day module permissions become grantable the tree
reads well, and they already title the blocks wherever the DMS lists them.

**Q12. How are the routes authorized?**
Each controller route is bound to the block it feeds with
`@AuthUserWithPermission(<component or child target>)` instead of
`@AuthOwnerOnly()`. Today both grant the owner alone (module scoping), but the
binding documents which block a route serves and follows the block if the DMS
opens module permissions later.

## 4. Navigation

**Q13. Sidebar?**
Three categories under the module root, as the mockup: *Monitor* (Overview,
Request logs), *Explore* (Routes), *Configure* (Settings). The module keeps
`landingPage: "overview"`.

**Q14. Page ids and URLs change (`summary` → `overview`)?**
Yes: `/modules/api/overview`, `/modules/api/logs`, `/modules/api/routes`,
`/modules/api/settings`. The DMS redirects `/modules/api` to the module's
landing page, the Overview, query and hash kept, so the only broken links
are bookmarks of `/modules/api/summary`.

**Q15. Live nav badges (14 server errors, 42 routes)?**
No. A `MenuOptions.badge` is a static string and a dynamic menu provider
builds entries, not badges of existing pages. The counts are on the pages
themselves (health hero, tab counters, tree footer).

## 5. Overview

**Q16. Layout?**

1. `HStack`: `ScopeChip` · `BetaBadge` (its meaning in a tooltip, F14) · `Spacer` · `LiveToggle` · `PeriodSelector` (segmented 1H / 24H / 7D / 30D, against the previous period, kept in the URL).
2. `HealthHero`: verdict (Operational / Degraded / Down), since when, reasons
   (n failing, n slow), four metrics (calls today, errors 24 h, average
   latency, routes in scope) and "View n server errors" (F01). With no request
   captured yet, it becomes the first-run guide (F17).
3. `ChartCard` *Traffic & errors* (`ChartMixed`: requests as an area, errors
   as columns on their own axis, previous-period delta) and `TopListCard`
   *Responses by class* (2xx / 4xx / 5xx with share and bars).
4. `ChartCard` *Error share per day* (`ChartColumn`, 4xx and 5xx stacked, 2xx
   left out so small changes show, F07), `ActivityFeed` *Needs attention*
   (the count of routes to check and "Last 24 h" in its head) and
   `TopListCard` *Slowest routes* (the average in ms, `valueSuffix`).
5. `Card` *Recent requests* around a compact `TableView.fromSource` (each row
   opens the request side panel), and `ActivityFeed` *Activity*.

**Q17. Why `ActivityFeed` for "Needs attention"?**
Each row is an issue with a tone, an icon, a title (the route, in mono) and
meta lines (what is wrong in plain words, the number that triggered it) and
the top error on a third, mono line (`detail`), linking to the next step:
exactly the feed item shape. Each row is read whole (`wrap`), the card
growing with them, and folds past the fifth ("Show 3 more",
`visibleItems`).
Rows are ordered failing → slow → 4xx rate (F02). A `TopListCard` would force
one number format on rows that measure different things.

**Q18. The "Filter by URI" input of the old Overview?**
Removed (F16): it filtered half the page. Filtering lives where it is
complete (Routes, Request logs).

**Q19. The period selector drives what?**
The two charts, the two top lists and the recent requests
(`periodScope: "api"`). The health hero and "Needs attention" are about now
(24 h) and say so. The selector is the DMS's, id `api`: it keeps the period
in the URL (`?api.period=last-24h`), and a link carrying it opens on it; the
last one picked on any page of the console is the default of the others
(`rememberKey`). It writes the start of the window from now ("since
yesterday 17:05") and draws no comparison control: the cards always compare
with the period before.

## 6. Request logs

**Q20. Hand-written table or `TableView.fromSource`?**
`TableView.fromSource`. It brings search, tabs with counters, quick filters,
"Load more" pagination, empty states, density, a row drawer with J / K
navigation and `?record=` deep links: most of F03, F09 and F10 for free. The
route answers `{ results, total }` with `offset` / `limit`, search, sort and
filters.

**Q21. Filters?**
- Tabs All / 2xx / 4xx / 5xx on the status class, with counters (F09, F10).
- Quick filters: Method, Slow only (a separate toggle, so "slow 5xx" is a
  question you can ask, F09). The period is the toolbar's DMS
  `PeriodSelector` (1H / 24H / 7D / 30D, capped by the log retention, and
  "All time" for every request kept, `?api.period=all`), which the table
  follows (`periodScope`).
- Search: path, request id, error message, opened with `/`
  (`searchShortcut`); its empty state offers "Clear search" (`clearSearch`).
- From another page, `?route=METHOD%20/path`, `?path=`, `?error=` and
  `?slow=true` open the table pre-filtered, and `?requests.tab=5xx` picks the
  tab: the source table's `queryParamFilters`. Those filters have no chip in
  the table: `LogsFilters` names them above it, each with a way to remove
  it. An incident's range is a linked filter of its own
  (`?since=&until=`), which the route intersects with the page's period: the
  period selector stays on the period the user chose, and removing the
  range leaves it there.

**Q22. Live mode?**
The DMS page live mode: the page declares `live: { maxRate: 5 }`, its toolbar
holds the DMS `LiveToggle`, and the table follows the capture's realtime
topic (`realtimeTopic`), held while paused (`liveHold`, "40 new requests ·
2 in 5xx · Show", the breakdown `useLiveMissedErrors` gives the page), while
a request is open in the side panel, while scrolled down, while searched and
while sorted otherwise than newest first, the strip naming the reason
("Table on hold · search active"). Its route lists a held table as it stood
(`liveHeldAt`), through search, sort and paging. `LiveTraffic` above the
table, the per-minute histogram of the last hour, follows the same state
(`usePageLiveRefresh`), with a visible paused / retrying state when a read
fails (F10).

**Q23. The drawer?**
A side panel: the row action's target is `{ type: "sidePanel", component:
RequestDetail, rowTitle: "$api.request.heading", positionLabel:
"$api.request.position", notFound }`, run on a single click
(`rowClick: "single"`). The DMS draws the header ("POST /api/orders",
"Request 3 of 50 shown", ∧ ∨, J / K, close), highlights the open row and
keeps it in `?record=`; a request beyond the listed rows is read through the
table's own single-log route (`fetchRowUrl`), and one no longer stored opens
the DMS not-found state in the console's words. `RequestDetail` shows the error message and
stack first, timing against the slow threshold, captured
headers, request and response bodies with a redaction note, and the actions
Replay in tester, Copy cURL, Open route, Same error (F03). A failed load says
why in the panel instead of `console.error`.

## 7. Routes

**Q24. Layout?**
`SplitLayout`: `RouteTree` in its aside, then `RouteHeader` and a `Tab`
(`persistState`) holding Statistics, Documentation and Tester. A first try
with a `Grid` row put the detail under the tree: the grid sizes its columns on
the number of cells in a row, so a `colSpan: 3` cell in a two-cell row wraps. The route is `?route=<id>` and the tab `?tab=<slot>`
(`?tab=tester`), so both are links and the tab stays when you switch routes
(F04). On a phone, a route chosen in the tree brings the header into view by
its block key (`scrollToBlock("explorer.header")`).

**Q25. Tree?**
Full paths with the folder prefix dimmed and `:params` highlighted, 24 h
traffic and a health dot on every route, a method segmented control, an
"Only routes needing attention" toggle, `/` to focus the filter, ↑ / ↓ to move
(F15). Folders only group: selecting a folder is gone, and so are the folder
endpoints.

**Q26. Tabs?**
Three instead of four (F06): *Statistics* (KPIs, requests by status, response
time with the slow threshold drawn, Top errors grouped by status and message,
recent requests of the route, F13; a route without a call over the
period shows one empty state instead, its `Guard`, with "Test this route"; its charts name their series with the DMS series legend, `showSeriesLegend`), *Documentation* (badged "Beta", example request as cURL / fetch, auth, body
fields, headers, responses with the source line of each error, the request
pipeline in order, internals collapsed), *Tester* (Body / Headers / Query /
Path, body prefilled from the inferred fields, ⌘↵ to send, a warning when the
call writes data, status text / time / size, a link to the matching log,
history that restores the response too, F05). Configuration merges into
Documentation.

## 8. Settings

**Q27. Custom page or DMS `Form`?**
DMS `Form` with sections: Route visibility, Retention, Capture & privacy,
Health thresholds (F11). Scope as `SelectType({ display: "cards" })`, its
three options on one row (`columns: 3`), with the number of routes each
option covers, served per request (F12); the statistics retention's 30, 60
or 90 days are one row of choice cards too. Retentions and
body size with `defaultValue` = the module default, so the form shows
"Module default · Use default" and "Changed · was X" by itself. Captured
headers become an editable `TagsType` (a new persisted override); the
always-redacted keys and the error-rate threshold are read-only fields.

**Q28. The retention impact preview of the mockup ("deletes ~96,400
entries")?**
Live, by `RetentionInput`: a lowered retention says how many requests it
deletes (read from the server as the value changes, debounced), and saving
asks to confirm. The DMS form has no hook to compute a hint from an unsaved
value nor a confirmation on submit, so the field brings both: the
confirmation is a validator of the enclosing form (`useEnclosingForm`),
which submits the form again once confirmed.

## 9. Visual language

**Q29. Method and status colours?**
One token-based set used everywhere (F08): GET info, POST success, PUT /
PATCH warning, DELETE error, HEAD / OPTIONS neutral; status chips by class.
In tables they are the DMS's status pill displays, toned per method or per
row (`toneField`); in custom blocks the `ApiMethodBadge` / `ApiStatusBadge`
components built on `DmsStatusPill`.

## 10. What is left out

**Q30. Which mockup elements are not built, and why?**
- "Alert me on incidents": the automation module already exposes a
  `route-unhealthy` trigger; wiring a one-click alert needs an automation
  API the interface does not offer.
- Live nav badges (Q15).
- A route count on each scope card of Settings (F12): a select option's
  description is an i18n key without parameters, so the count is on the scope
  chip of each page instead.
- Rows sliding into the logs table in Live mode (Q22).
- p95 latency: the day rollups store min / average / max only. Adding a
  percentile needs a different storage, out of scope.
- The "Prose documentation is not stored yet" line stays a line: route
  editing ships with the Module Builder.

## 11. Bugs found on the way

Fixed in this PR, all reproduced on the playground first:

- A thrown `HTTPResult` (`throw new HTTPResult(422, { error })`) was logged
  with the message `[object Object]`. The capture now reads the error out of
  the result's body, and a 4xx / 5xx returned without throwing carries the
  `error` / `message` of its body too: that is what "Top errors" and "Needs
  attention" group by.
- `defu` concatenates arrays: a project configuring
  `requestLogCaptureHeaders: ["content-type"]` kept the eight default headers
  on top of it. The config is now overlaid key by key.
- The settings route turned every field missing from the body into `null`,
  so saving the scope alone cleared every numeric override. With the partial
  bodies the DMS sends since 0.6 that would have happened on every save. A missing field
  now keeps its value, `null` clears it, and a value equal to the module
  default is stored as "no override".
- When the console runs from a local checkout (its playground), its own
  `/api/monitoring/*` routes counted as the project's: the dashboard watched
  itself polling. They are module routes now, whatever the checkout.
- A first start registers every route at once: the activity feed showed
  only "Route registered" lines. Registrations of one day are one entry.

## 12. Catalog

**Q32. Anything for the Modules catalog?**
Yes, the 0.4 `ModuleInfo` hooks: version (from `package.json`), category
"Developer", status `attention` while a route fails or is slow (`live`
otherwise) and a two-line readout (routes and average latency, error share
over 24 h).

## 13. Testing

**Q33. How is it tested?**
- Backend unit tests (vitest) for the new readers: log listing with offset /
  total and filters, needs-attention ranking, top errors grouping, settings
  merge, period parsing.
- Frontend unit tests for the URL / filter helpers and the tester request
  builder.
- `pnpm lint`, `pnpm typecheck`, `pnpm knip` (the front end included),
  `pnpm build`, `pnpm test`, and `ajs dms verify-source` for the front end.
- End to end on the playground (MongoDB, DMS 0.7.13, dms-frontend 0.5): traffic
  generated on demo routes (healthy, slow, failing, 4xx), every page checked
  in both themes, every drill-down followed, every bug found fixed in the PR.
