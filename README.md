# @antelopejs/dms-api

<div align="center">
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge&labelColor=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
<a href="https://antelopejs.com"><img src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" alt="Documentation"></a>
</div>

`@antelopejs/dms-api` adds an API console to the AntelopeJS DMS. Open
**Modules → API** (`/modules/api`):

- **Overview**: is the API healthy, since when and why not, with traffic,
  errors, the routes needing attention and the slowest ones.
- **Request logs**: every captured request, filtered by status class, method,
  slowness or period; a request opens with its error, timing, headers and
  bodies, and can be replayed in the tester.
- **Routes**: every registered route with its statistics, its contract
  (inferred from its code and its traffic) and a tester.
- **API settings**: the routes the console watches, retention, captured
  headers and the slow threshold.

It requires `@antelopejs/dms` `>=0.7.11 <0.8.0` (`@antelopejs/interface-dms`
0.5.6) and `@antelopejs/dms-frontend` `>=0.5.2 <0.6.0`. These DMS releases
bring the pieces the console is built on: the row side panel, the page's
Live / Pause state and its holds, the period kept in the URL, the column tones
and the `Guard` block.

The Overview, the Request logs and Routes have the DMS **Live / Pause**
toggle (the L key). Live, the default, the page follows new requests as the
DMS realtime channel announces them, each block read again at most every 5 s
(Request logs), 10 s (Overview) or 15 s (Routes), every minute once the
Overview or Routes show a week or more, and on that clock while the realtime
channel is down. Paused, nothing is read: the toggle says what was missed
("Paused · 40 new requests · 2 in 5xx"), the request tables keep their rows,
search, sort and "Load more" included, and offer "N new · Show"; resuming
reads each block once. The page also pauses by itself while its browser tab
is hidden and while you type in the Tester, and a request table holds its
rows while one of them is open in the side panel (and, in the Request logs,
while you read further down). The choice is one for the three pages, and
`?live=0` opens a page paused.

A request opens in a side panel on the right, on a single click on its row,
from every request table: the panel is titled with its method and path, J / K
step through the rows shown, and the URL names it (`?record=`), so a link or a
reload opens it again. In the Request logs, `/` opens the search and `?` the
list of shortcuts; in Routes, `/` opens the route filter. The DMS Shortcuts
page lists them. The period of a page is its period selector's (1H, 24H, 7D,
30D, and "All time" in the Request logs), kept in the URL
(`?api.period=last-24h`); without one, the page opens on the last period
picked on any of the three pages, else the last 24 hours. An incident of the
Overview opens the Request logs on its own range (`?api.from=&api.to=`).
Dates and times follow the user's Language & region preferences (time zone,
clock, date format), on a 24-hour clock by default.

This module is the dashboard for your API, not the HTTP server implementation.
Your application still needs an API provider such as `@antelopejs/api`, the
DMS runtime, and a database.

## Start with the demo

[template-dms-demo](https://github.com/AntelopeJS/template-dms-demo) already
loads this module and its supporting infrastructure. Follow its README to
install the project, start both backend and frontend processes, and create
the first administrator.

For an existing DMS project, add a package module entry to the `modules` map
in `antelope.config.ts`:

```ts
"dms-api": {
  source: {
    type: "package",
    package: "@antelopejs/dms-api",
    version: ">=0.0.1 <1.0.0",
  },
},
```

Install the declared modules with `pnpm exec ajs project modules install`,
then restart the backend before restarting the frontend. The module registers
its Vue 3 Inertia frontend module automatically through
`frontend-vue/dms.frontend.ts`.

## Configuration and data handling

[src/config.ts](src/config.ts) defines the supported settings, including
statistics and request-log retention, the slow-request threshold, body-size
limits, and the header capture allowlist. Retention uses milliseconds; body
limits use bytes. Settings saved through the dashboard override the module
configuration at runtime. A field set back to its module default ("Use
default") holds no override; the retentions have no such button, since
lowering one deletes data. An empty list of captured headers is an override
of its own: no header is captured.

The cURL and fetch snippets of a route and a request are written against the
DMS's public API origin, its `apiBaseUrl` (read through `GetApiBaseUrl()`):
set it to the URL clients reach the API at, such as `https://api.example.com`.
Under `ajs dms dev` it follows the dev server.

Statistics are kept 90 days by default, and the dashboard offers 30, 60 or
90 days. The 30D period compares itself with the 30 days before it, so it
needs 60 days or more: with 30 days, the 30D comparison is unavailable.
Request logs, which hold full requests, are kept 30 days by default,
independently of the statistics. Lowering a retention from the dashboard shows how much the
next hourly prune deletes and asks to confirm it.

The module configuration follows the dashboard's rules: the module does not
start with a value the Settings page would refuse (statistics kept other than
30, 60 or 90 days, a slow threshold off its 50 ms step, a body cap or a log
retention out of bounds, a secret header to capture).

The console only counts your API's traffic. Its own calls (`/api/monitoring`),
the DMS's (`/dms`, the realtime channel, the page layouts, the session check,
its Settings pages and their tables) and the DMS console's pages are neither
logged nor counted. Requests sent from the Tester are logged, marked as such,
but left out of the statistics, the health and the incidents. The Tester marks
its calls with a short-lived token the module signs
(`x-antelopejs-api-source`), which only a user allowed to use the Tester
obtains: a client cannot leave the statistics by declaring itself the Tester.
Behind several instances, give them the same `testerSourceSecret` so each one
accepts the tokens of the others.

### Upgrading from 0.1

The stored data of earlier versions is not migrated. Drop the
`request_log`, `routes_statistics` and `migrations` tables of the `dms-api`
schema when upgrading; the module creates them again. The API settings answer
the error-rate thresholds as ratios (`0.05`), and the `api.get-api-health`
automation answers `failingRoutes` instead of `routesWithErrors24h`.

Request logs can contain application data. Review the capture and retention
settings before collecting real traffic, and use synthetic requests for
screenshots or shared demos. The module prunes logs and statistics hourly.

## Development

Use the pnpm version declared in `package.json`. The repository's `dev` script
starts its playground backend; `frontend:dev` starts the published Inertia
dashboard loader. The playground connects to MongoDB at
`mongodb://localhost:27017` unless `MONGO_URL` points it elsewhere. Run `pnpm --dir playground traffic` while the playground runs to send
its demo storefront routes a few hundred requests (healthy, slow, failing and
client errors), so every page has something to show. `pnpm build`
compiles the backend, and `pnpm test` runs the backend unit tests (`tests/`)
followed by the frontend test suite, and `pnpm knip` checks the dependencies
of both. To build and typecheck the frontend module against the installed
DMS, run `pnpm exec ajs dms verify-source -m ../frontend-vue` from
`playground/`; or set `DMS_FRONTEND_WORKSPACE` to the workspace generated by
`ajs dms prepare`, then run `pnpm --dir frontend-vue typecheck`.
