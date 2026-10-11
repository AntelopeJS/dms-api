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

It requires `@antelopejs/dms` 0.7.4 or later (`@antelopejs/interface-dms` 0.5.1)
and `@antelopejs/dms-frontend` 0.5.2 or later. The request panel and the Live
mode rewrite the page URL, then navigate from it: dms-frontend 0.5.2 fixes the
navigation after such a rewrite, and is the version the console is tested
with.

The Overview, the Request logs and Routes have a **Live / Pause** control.
Live, the default, the page follows new requests as the DMS realtime channel
announces them. Paused, nothing moves, and the control counts the requests that
arrived meanwhile. A hidden tab or typing in the Tester pauses the whole page;
an open request, a search, another sort, more rows loaded or a scroll down hold
the request table alone, and say why. The choice is kept for the three pages.

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
configuration at runtime; clearing a field, or setting it back to the module
default, removes the override.

`publicApiUrl` is the base URL clients reach the API at, such as
`https://api.example.com`, without a trailing slash. The console writes it
into the cURL and fetch snippets of a route and a request. Unset, they use the
origin of the request the console was loaded with, which is wrong behind a
proxy or when the console and the API have different hosts:

```ts
"dms-api": {
  source: { /* … */ },
  config: {
    publicApiUrl: "https://api.example.com",
  },
},
```

Statistics are kept 90 days by default, and the dashboard offers 30, 60 or
90 days. The 30D period compares itself with the 30 days before it, so it
needs 60 days or more: with 30 days, the 30D comparison is unavailable. A
value outside these choices set in the module configuration is kept. Request
logs, which hold full requests, are kept 30 days by default, independently of
the statistics. Lowering a retention from the dashboard shows how much the
next hourly prune deletes and asks to confirm it.

The console only counts your API's traffic. Its own calls (`/api/monitoring`),
the DMS's (`/dms`, the realtime channel, the page layouts, the session check,
its Settings pages and their tables) and the DMS console's pages are neither
logged nor counted. Requests sent from the Tester are logged, marked as such,
but left out of the statistics, the health and the incidents.

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
followed by the frontend test suite. To typecheck
the complete application, set `DMS_FRONTEND_WORKSPACE` to the workspace
generated by `ajs dms prepare`, then run `pnpm --dir frontend-vue typecheck`.
