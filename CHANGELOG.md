# Changelog

## v0.6.0

[compare changes](https://github.com/AntelopeJS/dms-api/compare/v0.5.1...v0.6.0)

### 🚀 Enhancements

- **frontend:** Enforce the backend boundary in production builds ([#61](https://github.com/AntelopeJS/dms-api/pull/61))

### 🩹 Fixes

- **frontend:** Present API failures through the core presenter ([#92](https://github.com/AntelopeJS/dms-api/pull/92))

### 💅 Refactors

- Clean up the tests, comments, types and oversize files ([#59](https://github.com/AntelopeJS/dms-api/pull/59))
- Clear the residual ratchet findings ([#62](https://github.com/AntelopeJS/dms-api/pull/62))
- **amp:** Narrow the forwarded location header with a JSDoc type guard ([#65](https://github.com/AntelopeJS/dms-api/pull/65))

### 📖 Documentation

- **changelog:** Breaking changes of dms-api 0.5.1 ([#54](https://github.com/AntelopeJS/dms-api/pull/54))
- **readme:** Link the DMS in the opening line ([#80](https://github.com/AntelopeJS/dms-api/pull/80))
- **readme:** Use one Discord invite ([#77](https://github.com/AntelopeJS/dms-api/pull/77))
- Name DMS 0.11 and renderer 0.9, and ignore the playground's frontend build ([#55](https://github.com/AntelopeJS/dms-api/pull/55))

### 📦 Build

- **deps:** Bump @antelopejs/tooling-configs to 0.2.17 ([#66](https://github.com/AntelopeJS/dms-api/pull/66))

### 🏡 Chore

- Adopt the guardrail pack from tooling-configs 0.2.0 ([#56](https://github.com/AntelopeJS/dms-api/pull/56))
- Configure Renovate with the shared preset ([#57](https://github.com/AntelopeJS/dms-api/pull/57))

### ✅ Tests

- **skills:** Add eval cases for dms-api skills ([#58](https://github.com/AntelopeJS/dms-api/pull/58))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))
- Alessandro Aloisio ([@alessaloisio](http://github.com/alessaloisio))

## v0.5.1

[compare changes](https://github.com/AntelopeJS/dms-api/compare/v0.5.0...v0.5.1)

### ⚠️ Breaking changes

This patch release contains breaking changes. Ranges such as `^0.5.0` resolve to it.

- Requires `@antelopejs/dms` 0.11 (`>=0.11.0 <1.0.0`), `@antelopejs/interface-dms` `>=0.9.0 <1.0.0` and the renderer `@antelopejs/dms-frontend` 0.9 (`>=0.9.0 <0.10.0`). Projects on DMS 0.10 must stay on 0.5.0.
- Raised floors: `@antelopejs/interface-database` `>=0.1.11` and `@antelopejs/interface-database-decorators` `>=0.1.10` ([#53](https://github.com/AntelopeJS/dms-api/pull/53)).

### 📖 Documentation

- **changelog:** Upgrade notes of dms-api 0.5.0 ([#52](https://github.com/AntelopeJS/dms-api/pull/52))

### 📦 Build

- Run on @antelopejs/dms 0.11, interface-dms 0.9 and dms-frontend 0.9 ([#53](https://github.com/AntelopeJS/dms-api/pull/53))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.5.0

[compare changes](https://github.com/AntelopeJS/dms-api/compare/v0.4.2...v0.5.0)

### Upgrade notes

- Runs on `@antelopejs/dms` 0.10 (`@antelopejs/interface-dms >=0.8.0`) and builds its frontend with `@antelopejs/dms-frontend` 0.8.
- i18n keys removed: `api.request.position` (the request drawer shows the DMS's own position, [#44](https://github.com/AntelopeJS/dms-api/pull/44)), and `api.overview.no_previous`, `api.routes.statistics.no_baseline`, `api.routes.statistics.vs_previous` (the figures use the DMS comparison, [#45](https://github.com/AntelopeJS/dms-api/pull/45)). A project that overrides them can drop its overrides.

### 🚀 Enhancements

- **frontend:** The frontend registration as a pure function, declared as dmsFrontend ([#50](https://github.com/AntelopeJS/dms-api/pull/50))
- **pages:** Adopt the DMS page toolbar on Overview, Routes and Request logs ([#41](https://github.com/AntelopeJS/dms-api/pull/41))
- **pages:** Compare Overview and Routes with the previous period or nothing ([#45](https://github.com/AntelopeJS/dms-api/pull/45))
- **logs:** Open a request in a resizable drawer instead of the side panel ([#44](https://github.com/AntelopeJS/dms-api/pull/44))
- **logs:** Make the request histogram follow the page's period ([#47](https://github.com/AntelopeJS/dms-api/pull/47))

### 🩹 Fixes

- **logs:** Return the path of a request opened by its id ([#42](https://github.com/AntelopeJS/dms-api/pull/42))
- **routes:** Open the Routes page on its default route before it renders ([#46](https://github.com/AntelopeJS/dms-api/pull/46))
- **overview:** Keep the hero and the first row one height while they load ([#48](https://github.com/AntelopeJS/dms-api/pull/48))
- **settings:** Offer the module default on the settings form's fields ([#49](https://github.com/AntelopeJS/dms-api/pull/49))

### 📦 Build

- Run on @antelopejs/dms 0.10 and @antelopejs/dms-frontend 0.8 ([#51](https://github.com/AntelopeJS/dms-api/pull/51))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>
- Maxime Westhoven ([@mwesto](http://github.com/mwesto))

## v0.4.2

[compare changes](https://github.com/AntelopeJS/dms-api/compare/v0.4.1...v0.4.2)

### 🩹 Fixes

- Install API frontend from the root workspace ([#37](https://github.com/AntelopeJS/dms-api/pull/37))
- **frontend:** Run on @antelopejs/dms-frontend 0.7 ([#43](https://github.com/AntelopeJS/dms-api/pull/43))

### 📖 Documentation

- Clarify learning paths and illustrate real outcomes ([#40](https://github.com/AntelopeJS/dms-api/pull/40))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.4.1

[compare changes](https://github.com/AntelopeJS/dms-api/compare/v0.4.0...v0.4.1)

### 📖 Documentation

- Add user guide and module skill ([#33](https://github.com/AntelopeJS/dms-api/pull/33))
- Make dense guide sections easier to scan ([#36](https://github.com/AntelopeJS/dms-api/pull/36))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.4.0

[compare changes](https://github.com/AntelopeJS/dms-api/compare/v0.3.0...v0.4.0)

### 🚀 Enhancements

- ⚠️  Migrate to DMS 0.9 and renderer 0.6 ([#35](https://github.com/AntelopeJS/dms-api/pull/35))

#### ⚠️ Breaking Changes

- ⚠️  Migrate to DMS 0.9 and renderer 0.6 ([#35](https://github.com/AntelopeJS/dms-api/pull/35))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.3.0

[compare changes](https://github.com/AntelopeJS/dms-api/compare/v0.2.0...v0.3.0)

### 🏡 Chore

- **deps:** ⚠️  Require @antelopejs/dms 0.8 and interface-dms 0.6 ([#31](https://github.com/AntelopeJS/dms-api/pull/31))

### 🤖 CI

- Speed up pipeline ([#30](https://github.com/AntelopeJS/dms-api/pull/30))

#### ⚠️ Breaking Changes

- **deps:** ⚠️  Require @antelopejs/dms 0.8 and interface-dms 0.6 ([#31](https://github.com/AntelopeJS/dms-api/pull/31))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.2.0

[compare changes](https://github.com/AntelopeJS/dms-api/compare/v0.1.7...v0.2.0)

### 🚀 Enhancements

- ⚠️  Redesign the API console on DMS 0.7 as backend block pages ([#28](https://github.com/AntelopeJS/dms-api/pull/28))

### 🏡 Chore

- **playground:** Open module source ranges ([#26](https://github.com/AntelopeJS/dms-api/pull/26))

#### ⚠️ Breaking Changes

- ⚠️  Redesign the API console on DMS 0.7 as backend block pages ([#28](https://github.com/AntelopeJS/dms-api/pull/28))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.7

[compare changes](https://github.com/AntelopeJS/dms-api/compare/v0.1.6...v0.1.7)

### 🚀 Enhancements

- **frontend-vue:** Declare the @antelopejs/dms-frontend releases the layer supports ([#22](https://github.com/AntelopeJS/dms-api/pull/22))

### ❤️ Contributors

- Alessandro Aloisio ([@alessaloisio](http://github.com/alessaloisio))

## v0.1.6

[compare changes](https://github.com/AntelopeJS/dms-api/compare/v0.1.5...v0.1.6)

### 💅 Refactors

- **pages:** Let the routes and logs pages fill the panel ([#25](https://github.com/AntelopeJS/dms-api/pull/25))

### 🏡 Chore

- **lint:** Check @antelopejs/interface-* ranges ([#24](https://github.com/AntelopeJS/dms-api/pull/24))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.5

[compare changes](https://github.com/AntelopeJS/dms-api/compare/v0.1.4...v0.1.5)

### 🩹 Fixes

- **db:** Make route statistics updates atomic and key route lookups on method and uri ([#21](https://github.com/AntelopeJS/dms-api/pull/21))

### 🏡 Chore

- **playground:** Move to @antelopejs/dms-frontend 0.3.2 ([#20](https://github.com/AntelopeJS/dms-api/pull/20))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>
- Alessandro Aloisio ([@alessaloisio](http://github.com/alessaloisio))

## v0.1.4

[compare changes](https://github.com/AntelopeJS/dms-api/compare/v0.1.3...v0.1.4)

### 🩹 Fixes

- Route playground through public gateway ([#13](https://github.com/AntelopeJS/dms-api/pull/13))

### 💅 Refactors

- **build:** Merge tsconfig.build.json into tsconfig.json ([#15](https://github.com/AntelopeJS/dms-api/pull/15))

### 🏡 Chore

- **playground:** Configure DMS JWT secret ([#12](https://github.com/AntelopeJS/dms-api/pull/12))

### 🤖 CI

- **release:** Release next from a dedicated branch and restore requireCommits ([#16](https://github.com/AntelopeJS/dms-api/pull/16))
- **release:** Reference the shared release workflows through v1 ([#17](https://github.com/AntelopeJS/dms-api/pull/17))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.3

[compare changes](https://github.com/AntelopeJS/dms-api/compare/v0.1.2...v0.1.3)

### 🩹 Fixes

- **frontend:** Use DMS client-only component ([#11](https://github.com/AntelopeJS/dms-api/pull/11))

### 🏡 Chore

- Use supported DMS CLI commands ([#9](https://github.com/AntelopeJS/dms-api/pull/9))
- **orb:** Add playground services and lifecycle setup ([#10](https://github.com/AntelopeJS/dms-api/pull/10))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.2

[compare changes](https://github.com/AntelopeJS/dms-api/compare/v0.1.1...v0.1.2)

### 💅 Refactors

- **frontend:** Import the SDK through #dms/frontend-module ([#8](https://github.com/AntelopeJS/dms-api/pull/8))

### 🏡 Chore

- Require @antelopejs/core 1.7 ([#6](https://github.com/AntelopeJS/dms-api/pull/6))
- Align community files with the organization defaults ([#7](https://github.com/AntelopeJS/dms-api/pull/7))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.1

[compare changes](https://github.com/AntelopeJS/dms-api/compare/v0.1.0...v0.1.1)

## v0.1.0

[compare changes](https://github.com/AntelopeJS/dms-api/compare/v0.0.2...v0.1.0)

### 🩹 Fixes

- **frontend:** ⚠️  Register the frontend module under its package name ([#3](https://github.com/AntelopeJS/dms-api/pull/3))

#### ⚠️ Breaking Changes

- **frontend:** ⚠️  Register the frontend module under its package name ([#3](https://github.com/AntelopeJS/dms-api/pull/3))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.0.2

[compare changes](https://github.com/AntelopeJS/dms-api/compare/v0.0.1...v0.0.2)

### 🏡 Chore

- Regenerate lockfiles against the published DMS packages ([#1](https://github.com/AntelopeJS/dms-api/pull/1))
- **release:** Skip the npm auth pre-flight for trusted publishing ([#2](https://github.com/AntelopeJS/dms-api/pull/2))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

