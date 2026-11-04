---
covers:
  - src/services/tester-source.ts
  - frontend-vue/server/tester.ts
  - frontend-vue/dms.server.ts
  - frontend-vue/app/components/blocks/RouteTester.vue
  - frontend-vue/app/components/internal/RouteTesterRequest.vue
  - frontend-vue/app/components/internal/RouteTesterResponse.vue
  - frontend-vue/app/components/internal/routeTester/**
  - frontend-vue/app/utils/testerRequest.ts
  - frontend-vue/app/utils/testerHistory.ts
  - frontend-vue/app/utils/testerMasks.ts
  - frontend-vue/app/composables/useLastRoute.ts
docs:
  - docs/4.usage/3.routes.md
  - docs/3.configuration.md
  - docs/6.faq.md
---

# Tester

The Tester tab of a route: real calls through the frontend server, logged and marked apart from the traffic, and the token that marks them.

## Sub-features

- `a-tester-call-is-logged-and-marked-but-never-counted`
- `the-tester-sends-the-form-and-keeps-twenty-five-calls`
- `a-history-entry-restores-its-call-and-a-typed-authorization-beats-the-session`
- `headers-for-all-routes-are-kept-in-the-browser-but-credentials-are-not`
- `a-replayed-call-needs-its-credentials-and-redacted-values-by-hand`
- `a-secret-keeps-the-testers-token-valid-across-restarts`

## How to get to it (user POV)

- Modules › API › Routes › a route › Tester; Replay in tester from a request.

## Driving it with dms-control

```bash
dms-control journey "$RUN" tester
```
