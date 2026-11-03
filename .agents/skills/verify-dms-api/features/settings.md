---
covers:
  - src/routes/settings.ts
  - src/pages/settings.ts
  - src/services/settings.ts
  - src/services/settings-form.ts
  - src/config.ts
  - src/db/models/api_settings.model.ts
  - src/db/tables/api_settings.table.ts
  - frontend-vue/app/utils/settingsForm.ts
  - frontend-vue/app/components/blocks/SettingNumberInput.vue
  - frontend-vue/app/components/blocks/RetentionInput.vue
docs:
  - docs/4.usage/4.settings.md
  - docs/3.configuration.md
  - docs/6.faq.md
---

# Settings

The API settings page and the module options it overrides: scope, retentions, capture and privacy, the slow threshold and the refusal of an invalid configuration at start.

## Sub-features

- `the-form-shows-the-documented-defaults`
- `every-bound-of-the-form-is-enforced-on-its-edge`
- `use-default-returns-a-field-to-the-module-option`
- `the-module-refuses-to-start-with-a-value-the-form-would-refuse`
- `a-log-retention-of-no-day-is-refused-at-start`
- `the-scope-decides-which-routes-and-requests-every-page-watches`
- `lowering-a-retention-tells-what-the-next-prune-deletes`
- `the-hourly-prune-deletes-what-the-retention-passed`

## How to get to it (user POV)

- Modules › API › API settings; the `dms-api` entry of `antelope.config.ts`.

## Driving it with dms-control

```bash
dms-control journey "$RUN" settings
```
