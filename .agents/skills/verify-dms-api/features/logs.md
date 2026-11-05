---
covers:
  - src/routes/logs.ts
  - src/pages/logs.ts
  - src/pages/request-table.ts
  - src/services/request-log/list.ts
  - src/services/request-log/read.ts
  - src/services/request-log/access.ts
  - src/services/live.ts
  - src/services/live-feed.ts
  - frontend-vue/app/components/blocks/LogsFilters.vue
  - frontend-vue/app/components/blocks/LogsEmptyState.vue
  - frontend-vue/app/components/blocks/RequestDetail.vue
  - frontend-vue/app/components/blocks/LiveTraffic.vue
  - frontend-vue/app/components/internal/ApiBody.vue
  - frontend-vue/app/components/internal/ApiJsonTree.vue
  - frontend-vue/app/components/internal/ApiKeyValues.vue
  - frontend-vue/app/components/internal/ApiStatusBadge.vue
  - frontend-vue/app/components/internal/ApiTesterBadge.vue
  - frontend-vue/app/components/internal/RequestGeneral.vue
  - frontend-vue/app/components/internal/RequestTiming.vue
  - frontend-vue/app/utils/logsQuery.ts
  - frontend-vue/app/utils/requestDrawer.ts
  - frontend-vue/app/utils/search.ts
  - frontend-vue/app/utils/http.ts
docs:
  - docs/4.usage/2.request-logs.md
  - docs/4.usage/1.overview.md
---

# Request logs

The Request logs page: the histogram, the status tabs, the filters, the search, the drawer of one request and the live mode that holds the table.

## Sub-features

- `the-tabs-the-filters-and-the-search-narrow-the-list`
- `the-list-is-newest-first-sorts-and-pages`
- `pause-holds-the-table-and-counts-what-was-missed`
- `the-histogram-bars-follow-the-period`
- `a-link-names-a-range-with-since-and-until`
- `a-past-range-draws-at-most-120-bars`
- `filters-combine-with-the-status-tab`
- `the-list-sorts-by-duration-both-ways`
- `the-slow-labels-follow-the-threshold-in-seconds-or-milliseconds`
- `counts-are-grouped-and-all-time-compares-nothing`
- `a-request-opens-in-a-drawer-that-steps-through-the-list`

## How to get to it (user POV)

- Modules › API › Request logs; `?record=<id>` and the links of the Overview open it narrowed.

## Driving it with dms-control

```bash
dms-control journey "$RUN" logs
```
