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

## How to get to it (user POV)

- A procedure in Automation using `api.route-unhealthy`, `api.get-api-health` or `api.query-request-logs`.

## Driving it with dms-control

```bash
dms-control journey "$RUN" automation
```

## Gotchas

- The playground does not load `@antelopejs/dms-automation`, so the nodes' behaviour is not driven (see coverage/automation.md).
