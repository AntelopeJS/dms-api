---
covers:
  - src/automation/**
docs:
  - docs/5.extending.md
---

# Automation

The three nodes the module registers when `@antelopejs/dms-automation` is loaded: the Route unhealthy trigger, the Get API health action and the Query request logs action. Without the automation module the registration is a silent no-op.

## Sub-features

- `without-the-automation-module-the-registration-is-a-silent-no-op`
- `the-module-registers-its-three-nodes-with-their-documented-inputs`
- `get-api-health-restricts-its-breakdown-to-the-last-days`
- `query-request-logs-pages-caps-and-filters`
- `query-request-logs-next-cursor-reads-the-next-page`
- `route-unhealthy-fires-on-the-flags-it-watches-and-never-faster-than-ten-seconds`

## How to get to it (user POV)

- A procedure in Automation using `api.route-unhealthy`, `api.get-api-health` or `api.query-request-logs`.

## Driving it with dms-control

```bash
dms-control journey "$RUN" automation
```

## Gotchas

- The playground's fixture module stands in for the automation provider when `VERIFY_API_AUTOMATION=1` (a journey restarts the backend with it): it keeps the node types the module registers and runs `execute` and `activate` through `/verify-api/nodes`. The automation runtime itself is not loaded.
