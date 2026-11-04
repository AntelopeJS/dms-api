---
covers:
  - src/services/request-log/**
  - src/db/**
  - src/realtime.ts
  - src/services/statistics-write.ts
  - src/services/statistics-aggregate.ts
  - src/services/statistics-utils.ts
  - src/services/aggregate-cache.ts
  - src/services/traffic-samples.ts
  - src/memo.ts
  - src/services/index.ts
  - src/services/zod-json.ts
docs:
  - docs/1.introduction.md
  - docs/3.configuration.md
---

# Capture

What the module records of the project's API traffic: each request with its route, timing, allow-listed headers and size-capped, redacted bodies; internal traffic never.

## Sub-features

- `a-request-is-captured-with-its-facts`
- `a-thrown-error-keeps-its-message-and-its-stack`
- `the-consoles-own-and-the-dms-traffic-is-never-captured`
- `only-the-listed-headers-are-stored-and-secret-ones-never`
- `values-under-secret-looking-keys-are-redacted-before-storage`
- `bodies-above-the-cap-are-stored-truncated-and-flagged`
- `a-key-is-secret-by-the-words-it-is-made-of`

## How to get to it (user POV)

- Modules › API › Request logs, a request's drawer; API settings › Capture & privacy.

## Driving it with dms-control

```bash
dms-control journey "$RUN" capture
```

## Gotchas

- Statistics and health are written behind the response: journeys wait with `settled`.
