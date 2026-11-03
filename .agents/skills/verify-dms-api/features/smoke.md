---
covers:
  - src/index.ts
  - src/types/**
  - src/automation/index.ts
  - frontend-vue/dms.frontend.ts
  - frontend-vue/dms.frontend.build.ts
  - frontend-vue/tsconfig.json
  - frontend-vue/package.json
  - package.json
docs:
  - docs/1.introduction.md
  - docs/2.installation.md
---

# Smoke

The fixed journey every verdict runs: the introduction's "captures the requests your project's API answers and turns them into a health verdict, request logs".

## Sub-features

- `traffic-shows-in-the-overview-and-the-request-logs`: 25 good calls and one failing call give a Degraded verdict and a failing row.

## How to get to it (user POV)

- Modules › API › Overview, then Request logs.

## Driving it with dms-control

```bash
dms-control journey "$RUN" smoke
```
