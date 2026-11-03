---
covers:
  - src/routes/routes.ts
  - src/pages/routes.ts
  - src/services/routes-sync.ts
  - src/services/route-catalog.ts
  - src/services/route-contract.ts
  - src/services/route-statistics.ts
  - src/services/route-health.ts
  - src/services/scope.ts
  - src/services/links.ts
  - src/services/api-origin.ts
  - src/services/introspection/**
  - frontend-vue/app/components/blocks/RouteTree.vue
  - frontend-vue/app/components/blocks/RouteHeader.vue
  - frontend-vue/app/components/blocks/RouteDocumentation.vue
  - frontend-vue/app/components/internal/RouteInternals.vue
  - frontend-vue/app/components/internal/RouteTreeFooter.vue
  - frontend-vue/app/components/internal/ApiMethodBadge.vue
  - frontend-vue/app/components/internal/ApiPath.vue
  - frontend-vue/app/composables/useRouteSelection.ts
  - frontend-vue/app/composables/useLastRoute.ts
  - frontend-vue/app/composables/useRouteDetail.ts
  - frontend-vue/app/composables/useApiOrigin.ts
  - frontend-vue/app/middleware/defaultRoute.ts
  - frontend-vue/app/utils/routeExplorer.ts
  - frontend-vue/app/utils/snippets.ts
docs:
  - docs/4.usage/3.routes.md
  - docs/5.extending.md
  - docs/6.faq.md
---

# Routes

The Routes page: the tree of routes with health and filters, a route's header, its Statistics, its inferred Documentation and the URL that names a route and a tab.

## Sub-features

- `the-tree-groups-routes-by-folder-and-the-filters-narrow-it`
- `a-route-opens-with-its-header-and-the-url-names-it`
- `the-statistics-tab-adds-up-the-period`
- `the-documentation-tab-is-inferred-from-the-code-and-the-traffic`
- `authentication-is-read-from-the-guards-before-the-handler`

## How to get to it (user POV)

- Modules › API › Routes; a route's `?route=<METHOD> <path>&tab=statistics|documentation|tester` link.

## Driving it with dms-control

```bash
dms-control journey "$RUN" routes
```

## Gotchas

- Controller internals, Copy and Copy cURL write to the clipboard: not driven.
