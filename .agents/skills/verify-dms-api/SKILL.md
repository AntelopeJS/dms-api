---
name: verify-dms-api
description: "Drive the AntelopeJS dms-api module (the API console: health verdict, request logs, routes, tester and settings) the way the platform owner does, inside a DMS with free ports and its own MongoDB database, and post a verdict with evidence. Use to prove a change to AntelopeJS/dms-api works before merge, to verify a PR, or to check that a seeded break or door is caught."
---

# Verify dms-api

Every deterministic step is a `dms-control` command (`pnpm exec dms-control`, from `@antelopejs/dms`, Node 24). You choose which journeys to run and judge what they show. Work in progress: the feature map is being written.

```bash
C="pnpm exec dms-control"
RUN=$($C up --prepare --base origin/campaign/integration)
$C doctor "$RUN"
$C down "$RUN"
```

The verification playground (`playground/`) loads the module from the checkout, a fixture module that serves `/fx/*` routes, and a copy of the published `@antelopejs/api` patched by `fetch-api.mjs` so the module and the api agree on `RouteHandler.controller`.
