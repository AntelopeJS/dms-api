---
covers:
  - src/guards.ts
  - src/routes/index.ts
  - src/routes/tester.ts
docs:
  - docs/5.extending.md
---

# Access

Who may call the console: a session for every route, and for each block the permission the DMS role editor grants it.

## Sub-features

- `every-console-route-needs-a-session-and-the-block-it-serves`
- `a-role-opens-the-blocks-it-holds-and-no-others`

## How to get to it (user POV)

- Settings › Roles in the DMS; a member opens Modules › API.

## Driving it with dms-control

```bash
dms-control journey "$RUN" access
```

## Gotchas

- The permission ids are read from the refusals, so the journeys follow the module's own block ids.
