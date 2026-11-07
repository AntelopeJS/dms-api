---
covers:
  - src/services/statistics-prune.ts
  - src/services/request-log/prune.ts
  - src/services/settings-form.ts
  - src/routes/settings.ts
  - frontend-vue/app/components/blocks/RetentionInput.vue
  - frontend-vue/app/utils/settingsForm.ts
docs:
  - docs/4.usage/4.settings.md
---

# Retention

How long data is kept: what the next hourly prune deletes, the confirmation before a lower retention is saved, and the prune itself.

## Sub-features

- `lowering-a-retention-tells-what-the-next-prune-deletes`
- `lowering-a-retention-asks-before-it-deletes`
- `the-hourly-prune-deletes-what-the-retention-passed`

## How to get to it (user POV)

- Modules › API › API settings › Retention.

## Driving it with dms-control

```bash
dms-control journey "$RUN" retention
```

## Gotchas

- The prune runs at the turn of the hour: `clock.cjs` sets the backend's clock ahead so it fires within seconds.
