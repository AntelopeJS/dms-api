# dms-api redesign: grill-me session

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
  `app/composables` and `app/utils`.
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
| `HealthHero` | Wraps the public `DmsStatusSummary` (the design's health hero) with the verdict, its reasons and the drill-down action; also the first-run guide. |
| `LiveTraffic` | Per-minute histogram of the last hour with a Live toggle that shows its own failures; no block polls. |
| `RequestDetail` | The request drawer (error and stack first, timing, headers, bodies, Replay / cURL / Open route / Same error). |
| `RouteTree` | A filterable tree whose selection lives in the URL. |
| `RouteHeader`, `RouteDocumentation`, `RouteTester` | Everything under the selected route reads `?route=` from the URL. They render public DMS components (`DmsCard`, `DmsEmptyState`, `DmsStatusPill`) inside. Since DMS 0.6.1 a block's `fetchUrl` takes `{{query.route}}`, so the Statistics tab is now DMS blocks only (`KpiCard`, `ChartCard`, `TopListCard`, a request table filtered by `?route=`); these three stay custom for what they draw, not for how they read the route. |
| `SplitLayout` | A list beside its detail. `Grid` shares its columns equally, so a row of two cells cannot give one of them three quarters; `DmsMasterDetail` is a template component, not a block. |

The request tables also draw their cells with four small cell displays of the
module (`api:method`, `api:status`, `api:time`, `api:path`, registered with
`@RegisterDisplay`), so a GET or a 500 looks the same in a table and in a
custom block.

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
`/modules/api/settings`. The module's landing page makes `/modules/api` land
on the Overview, so the only broken links are bookmarks of
`/modules/api/summary`.

**Q15. Live nav badges (14 server errors, 42 routes)?**
No. A `MenuOptions.badge` is a static string and a dynamic menu provider
builds entries, not badges of existing pages. The counts are on the pages
themselves (health hero, tab counters, tree footer).

## 5. Overview

**Q16. Layout?**

1. `HStack`: `ScopeChip` · `Spacer` · `PeriodSelector` (segmented, 24 h / 7 d / 30 d, against the previous period).
2. `Banner` (beta, `info`, `sm`, dismissible): one line instead of ~90 words (F14).
3. `HealthHero`: verdict (Operational / Degraded / Down), since when, reasons
   (n failing, n slow), four metrics (calls today, errors 24 h, average
   latency, routes in scope) and "View n server errors" (F01). With no request
   captured yet, it becomes the first-run guide (F17).
4. `ChartCard` *Traffic & errors* (`ChartMixed`: requests as an area, errors
   as columns on their own axis, previous-period delta) and `TopListCard`
   *Responses by class* (2xx / 4xx / 5xx with share and bars).
5. `ChartCard` *Error share per day* (`ChartColumn`, 4xx and 5xx stacked, 2xx
   left out so small changes show, F07), `ActivityFeed` *Needs attention*
   and `TopListCard` *Slowest routes*.
6. `Card` *Recent requests* around a compact `TableView.fromSource` (each row
   opens the request drawer), and `ActivityFeed` *Activity*.

**Q17. Why `ActivityFeed` for "Needs attention"?**
Each row is an issue with a tone, an icon, a title (the route, in mono) and
meta lines (what is wrong in plain words, the number that triggered it, the
top error message) linking to the next step: exactly the feed item shape.
Rows are ordered failing → slow → 4xx rate (F02). A `TopListCard` would force
one number format on rows that measure different things.

**Q18. The "Filter by URI" input of the old Overview?**
Removed (F16): it filtered half the page. Filtering lives where it is
complete (Routes, Request logs).

**Q19. The period selector drives what?**
The two charts and the two top lists (`periodScope: "api"`). The health hero
and "Needs attention" are about now (24 h) and say so.

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
  question you can ask, F09), Period (1 h / 24 h / 7 d / 14 d, capped by the
  log retention).
- Search: path, request id, error message.
- From another page, `?route=METHOD%20/path`, `?error=` and `?slow=true` open
  the table pre-filtered, and `?requests.tab=5xx` picks the tab. A source
  table does not take `queryParamFilters` in its builder options, but its
  client honours them like any table view's, so the builder sets them with
  `mergeOptions`. Those filters have no chip in the table: `LiveTraffic`
  names them above it, each with a way to remove it.

**Q22. Live mode?**
`LiveTraffic` above the table: the per-minute histogram of the last hour,
refreshed every 5 s while Live is on, with a visible paused / retrying state
when polling fails (F10). The table keeps its own refresh: a source table
has no realtime, so new rows do not slide in by themselves.

**Q23. The drawer?**
`RequestDetail`, opened by a custom row action (`deepLink`, J / K through
the `navigation` prop). The docs promise that `isDefault` makes a row click
run the action; the DMS 0.6 table does not implement it yet, so the action is
also drawn inline (`isVisible`) and the row's own button opens it. The drawer
shows the error message and stack first, timing against the slow threshold, captured
headers, request and response bodies with a redaction note, and the actions
Replay in tester, Copy cURL, Open route, Same error (F03). A failed load says
why in the drawer instead of `console.error`.

## 7. Routes

**Q24. Layout?**
`SplitLayout`: `RouteTree` in its aside, then `RouteHeader` and a `Tab`
(`persistState`) holding Statistics, Documentation and Tester. A first try
with a `Grid` row put the detail under the tree: the grid sizes its columns on
the number of cells in a row, so a `colSpan: 3` cell in a two-cell row wraps. The route is `?route=<id>` and the tab `?tab=`, so both are links
and the tab stays when you switch routes (F04).

**Q25. Tree?**
Full paths with the folder prefix dimmed and `:params` highlighted, 24 h
traffic and a health dot on every route, a method segmented control, an
"Only routes needing attention" toggle, `/` to focus the filter, ↑ / ↓ to move
(F15). Folders only group: selecting a folder is gone, and so are the folder
endpoints.

**Q26. Tabs?**
Three instead of four (F06): *Statistics* (KPIs, requests by status, response
time with the slow threshold drawn, Top errors grouped by status and message,
recent requests of the route, F13; a route without traffic points to the
tester), *Documentation* (example request as cURL / fetch, auth, body
fields, headers, responses with the source line of each error, the request
pipeline in order, internals collapsed), *Tester* (Body / Headers / Query /
Path, body prefilled from the inferred fields, ⌘↵ to send, a warning when the
call writes data, status text / time / size, a link to the matching log,
history that restores the response too, F05). Configuration merges into
Documentation.

## 8. Settings

**Q27. Custom page or DMS `Form`?**
DMS `Form` with sections: Route visibility, Retention, Capture & privacy,
Health thresholds (F11). Scope as `SelectType({ display: "cards" })` with the
number of routes each option covers, served per request (F12). Retentions and
body size with `defaultValue` = the module default, so the form shows
"Module default · Use default" and "Changed · was X" by itself. Captured
headers become an editable `TagsType` (a new persisted override); the
always-redacted keys and the error-rate threshold are read-only fields.

**Q28. The retention impact preview of the mockup ("deletes ~96,400
entries")?**
As a hint computed when the page loads (how many logs the current retention
keeps and from when), not live while typing: the form has no hook to compute
a hint from an unsaved value.

## 9. Visual language

**Q29. Method and status colours?**
One token-based set used everywhere (F08): GET info, POST success, PUT /
PATCH warning, DELETE error, HEAD / OPTIONS neutral; status chips by class.
In tables they are the module's cell displays (`api:method`, `api:status`), in custom blocks the
`ApiMethodBadge` / `ApiStatusBadge` components built on `DmsStatusPill`.

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
  bodies of DMS 0.6 that would have happened on every save. A missing field
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
- `pnpm lint`, `pnpm typecheck`, `pnpm knip`, `pnpm build`, `pnpm test`.
- End to end on the playground (MongoDB, DMS 0.6, dms-frontend 0.5): traffic
  generated on demo routes (healthy, slow, failing, 4xx), every page checked
  in both themes, every drill-down followed, every bug found fixed in the PR.
