---
covers:
  - src/guards.ts
  - src/routes/index.ts
  - src/routes/tester.ts
docs:
  - docs/5.extending.md
---

# Access

Who may call the console: a session for every route, and the platform owner only, since the DMS grants a module page's permissions to the owner alone.

## Sub-features

- `every-console-route-needs-a-session-and-the-block-it-serves`
- `the-console-is-the-owners-and-a-role-holding-a-block-is-refused`

## How to get to it (user POV)

- The owner opens Modules › API; a member with any role is refused.

## Driving it with dms-control

```bash
dms-control journey "$RUN" access
```

## Gotchas

- The permission ids are read from the refusals, so the journeys follow the module's own block ids.
