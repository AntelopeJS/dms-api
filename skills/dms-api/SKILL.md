---
name: dms-api
description: Uses the @antelopejs/dms-api console of the AntelopeJS DMS (API health, request logs, per-route statistics, inferred route docs and a tester under /modules/api). Use when installing or configuring dms-api (retention, slow threshold, captured headers, testerSourceSecret), debugging a failing or slow route from its request logs, wiring its automation nodes (api.route-unhealthy, api.get-api-health, api.query-request-logs), or when a route is missing from the console.
icon: i-lucide-webhook
category: monitoring
tags: [api, monitoring, request-logs, routes, tester, automation]
---

# dms-api

Monitors the project's own HTTP API: it captures each request of the routes in scope, rolls them into per-route statistics, and infers each route's contract from its handler and traffic. It is a dashboard, not the HTTP server: the project still needs `@antelopejs/api`. User docs: https://dms.antelopejs.com/docs/modules/api (source: `docs/` of this package).

## When to reach for it

- Debug a route: read its failed requests in `/modules/api/logs` (its drawer holds the error, stack, headers and bodies) or replay one in the route's Tester.
- Alert on a broken route: an automation procedure on `api.route-unhealthy` (`flags`: `broken`, `slow`, `warn`; default `broken` + `slow`).

## Config (`antelope.config.ts`; the API settings page overrides it at runtime)

`statisticsLifetime` (ms, 30/60/90 days only), `requestLogRetention` (ms, 1–366 days), `requestSlownessThreshold` (ms, steps of 50), `requestLogMaxBodySize` (bytes), `requestLogCaptureHeaders` (lower case), `authMiddlewareNamePatterns`, `authMiddlewareCallbacks`, `testerSourceSecret` (same value on every instance). The module refuses to start with a value its settings page would refuse.

## Gotchas

- Scope defaults to **Own routes**: routes a module registers show only under Module routes or All routes.
- Its own calls, the DMS's calls and Tester calls are never counted in statistics or health.
- cURL snippets use the DMS `apiBaseUrl`: set it to the public API origin.
- The Tester forwards calls through the module's own frontend server route `POST /api/_dms-api/tester` (`frontend-vue/dms.server.ts`); dms-frontend 0.6 has no built-in tester route.
- It needs `@antelopejs/dms` 0.11 or later (`interface-dms` 0.9 or later) and `@antelopejs/dms-frontend` 0.9; 0.5.0 is the DMS 0.10 line.
- A route reads "Auth unknown" when the check happens inside the handler; guard with the DMS auth decorators or name the middleware in `authMiddlewareCallbacks`.
- Each block is its own permission (`@AuthUserWithPermission(<block>)`): grant roles the blocks they need.
- Request logs can hold application data; secret-looking keys are always redacted.
- Overview and Routes compare with the period before or with nothing (`?api.compare=previous-period|none`); every chart draws the compared period dashed and every figure says its change and its value then. No year-back comparison: the retention never keeps a year of statistics. The Request logs compare nothing.
- The Request logs histogram follows the page's period (`GET /api/monitoring/logs/live?preset=last-7-days`, or `from` / `to`, or `preset=all`), in bars of 1 min (1H), 15 min (24H), 2 h (7D) or 6 h (30D, All time), all traffic in scope whatever the table filters.
