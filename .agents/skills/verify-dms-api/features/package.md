---
covers:
  - skills/**
  - frontend-vue/i18n/**
  - frontend-vue/build/**
  - frontend-vue/dms.server.ts
  - frontend-vue/server/**
  - src/frontend-module.ts
  - src/guards.ts
docs:
  - docs/2.installation.md
  - docs/1.introduction.md
---

# Package

What a project installs: the module with its build, the Vue layer, the skill, the locales, and the ranges the docs name.

## Sub-features

- `the-tarball-holds-what-the-manifest-names`
- `the-ranges-and-the-skill-match-what-the-docs-name`
- `the-docs-links-and-the-two-locales-are-complete`

## How to get to it (user POV)

- `ajs project modules add @antelopejs/dms-api`.

## Driving it with dms-control

```bash
dms-control journey "$RUN" package
```
