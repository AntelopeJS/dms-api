---
covers:
  - src/routes/overview.ts
  - src/pages/overview.ts
  - src/pages/displays.ts
  - src/pages/blocks.ts
  - src/pages/toolbar.ts
  - src/pages/scope-chip.ts
  - src/pages/module.ts
  - src/pages/index.ts
  - src/services/overview.ts
  - src/services/overview-lists.ts
  - src/services/health-rules.ts
  - src/services/attention.ts
  - src/services/activity.ts
  - src/services/comparison.ts
  - src/services/period.ts
  - src/services/window.ts
  - src/services/traffic.ts
  - src/services/live.ts
  - src/services/live-feed.ts
  - src/services/composed-text.ts
  - src/services/zod-json.ts
  - frontend-vue/app/components/blocks/HealthHero.vue
  - frontend-vue/app/components/blocks/ScopeChip.vue
  - frontend-vue/app/components/blocks/BetaBadge.vue
  - frontend-vue/app/components/blocks/SplitLayout.vue
  - frontend-vue/app/components/internal/HealthHeroMetrics.vue
  - frontend-vue/app/composables/useApiPeriod.ts
  - frontend-vue/app/composables/useClientValue.ts
  - frontend-vue/app/composables/useDateFormat.ts
  - frontend-vue/app/composables/useLiveMissedErrors.ts
  - frontend-vue/app/utils/health.ts
  - frontend-vue/app/utils/format.ts
  - frontend-vue/app/utils/minuteHistogram.ts
  - frontend-vue/app/plugins/displays.ts
  - frontend-vue/app/config/shortcuts-registry.ts
docs:
  - docs/4.usage/1.overview.md
---

# Overview

The Overview: the health verdict and why, the attention list, the slowest routes, the error share, traffic, status classes, period, comparison, scope chip and live mode.

## Sub-features

- `the-blocks-rank-the-routes-by-what-is-wrong-with-them`
- `the-period-and-the-comparison-are-kept-in-the-url-and-shared-by-the-pages`
- `down-reads-the-last-five-minutes-and-not-the-last-fifteen`
- `errors-older-than-five-minutes-do-not-make-the-api-down`
- `a-comparison-beyond-the-kept-statistics-compares-with-nothing`
- `the-hero-says-how-long-the-verdict-has-held-and-when-it-was-checked`
- `a-comparison-the-page-does-not-know-compares-with-nothing`
- `every-figure-compared-with-the-period-before-says-its-change-and-its-value`
- `the-slowest-routes-are-ranked-by-average-latency-not-by-their-slowest-call`
- `the-module-path-redirects-to-the-overview`
- `a-route-is-flagged-at-the-documented-edges-whatever-the-period`
- the verdict ladder: `with-no-traffic-the-verdict-is-idle`, `nineteen-failing-calls-are-too-few-to-judge`, `one-failing-call-in-a-hundred-is-degraded`, `one-failing-call-in-a-hundred-and-one-is-operational`, `a-fifth-of-the-calls-failing-is-down`, `nineteen-percent-failing-is-degraded-not-down`

## How to get to it (user POV)

- Modules › API › Overview (`/modules/api/overview`).

## Driving it with dms-control

```bash
dms-control journey "$RUN" overview
```
