<div align="center">

# @antelopejs/dms-api

<a href="https://www.npmjs.com/package/@antelopejs/dms-api"><img alt="npm" src="https://img.shields.io/npm/v/@antelopejs/dms-api?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@antelopejs/dms-api?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img alt="Discord" src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000"></a>
<a href="https://dms.antelopejs.com/docs/modules/api"><img alt="Documentation" src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000"></a>

The API console of the AntelopeJS DMS: health, request logs, route statistics and a tester.

</div>

![The API Overview: health verdict, routes needing attention, slowest routes and error share](./docs/images/overview.png)

## What it does

- Tells whether your API is healthy, since when and why not, with traffic, errors and the slowest routes.
- Captures every request of your project's routes with its error, timing, headers and bodies (size-capped and redacted).
- Lists every registered route with its statistics and a contract inferred from code and traffic.
- Sends test requests from a built-in tester, logged apart from real traffic.
- Applies its settings (watched routes, retention, captured headers, slow threshold) without a restart.

It is the dashboard for your API, not the HTTP server: the project still needs an API provider such as `@antelopejs/api`.

## Install

Run the AntelopeJS CLI from the root of a project that already loads `@antelopejs/dms`:

```bash
ajs project modules add @antelopejs/dms-api
```

## Quick start

The module works without configuration. Restart the backend, then the frontend, and open **Modules → API** (`/modules/api`). Review the [configuration](https://dms.antelopejs.com/docs/modules/api/configuration) before capturing real traffic: request logs can hold application data.

To try it with sample traffic, clone this repository and run its playground:

```bash
pnpm install && pnpm dev          # backend
pnpm frontend:dev                 # dashboard, in a second terminal
pnpm --dir playground traffic     # a few hundred demo requests
```

[template-dms-demo](https://github.com/AntelopeJS/template-dms-demo) also loads the module.

## Compatibility

<!-- antelopejs-docs-compat:start -->

| Package                                     | Supported                                                                 | Tested with                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `@antelopejs/interface-api`                 | `file:.campaign/tgz/antelopejs-interface-api-f2a99b5.tgz`                 | `file:.campaign/tgz/antelopejs-interface-api-f2a99b5.tgz`                 |
| `@antelopejs/interface-api-util`            | `file:.campaign/tgz/antelopejs-interface-api-util-639f38b.tgz`            | `file:.campaign/tgz/antelopejs-interface-api-util-639f38b.tgz`            |
| `@antelopejs/interface-core`                | `file:.campaign/tgz/antelopejs-interface-core-52413a9.tgz`                | `file:.campaign/tgz/antelopejs-interface-core-52413a9.tgz`                |
| `@antelopejs/interface-database`            | `file:.campaign/tgz/antelopejs-interface-database-02e0360.tgz`            | `file:.campaign/tgz/antelopejs-interface-database-02e0360.tgz`            |
| `@antelopejs/interface-database-decorators` | `file:.campaign/tgz/antelopejs-interface-database-decorators-e79a62b.tgz` | `file:.campaign/tgz/antelopejs-interface-database-decorators-e79a62b.tgz` |
| `@antelopejs/interface-dms`                 | `file:.campaign/tgz/antelopejs-interface-dms-0cfaaa3.tgz`                 | `file:.campaign/tgz/antelopejs-interface-dms-0cfaaa3.tgz`                 |
| `@antelopejs/interface-dms-automation`      | `file:.campaign/tgz/antelopejs-interface-dms-automation-b4bc5d2.tgz`      | `file:.campaign/tgz/antelopejs-interface-dms-automation-b4bc5d2.tgz`      |

<!-- antelopejs-docs-compat:end -->

The module also needs a DMS backend in a release that implements the `@antelopejs/interface-dms` range above, and the `@antelopejs/dms-frontend` renderer in the range its frontend module declares in `engines["@antelopejs/dms-frontend"]` of `frontend-vue/package.json`; the `ajs dms` CLI refuses to build it with a renderer outside that range. It runs on these providers:

- API provider: `@antelopejs/api`.
- Database: an `@antelopejs/interface-database` implementation, such as `@antelopejs/mongodb`.

Upgrading from 0.1? Read the [FAQ](https://dms.antelopejs.com/docs/modules/api/faq#upgrading-from-01).

## Documentation

- [Introduction](https://dms.antelopejs.com/docs/modules/api/introduction)
- [Installation](https://dms.antelopejs.com/docs/modules/api/installation)
- [Configuration](https://dms.antelopejs.com/docs/modules/api/configuration)
- [Usage](https://dms.antelopejs.com/docs/modules/api/usage/overview)
- [Extending](https://dms.antelopejs.com/docs/modules/api/extending)
- [FAQ](https://dms.antelopejs.com/docs/modules/api/faq)

The guide's sources live in [`docs/`](./docs). The package also ships the `dms-api` Claude Code skill in [`skills/`](./skills), declared under `antelopeJs.skills`.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. Use the pnpm version declared in `package.json`. The playground connects to MongoDB at `mongodb://localhost:27017` unless `MONGO_URL` points elsewhere.

One root install includes the backend and shipped Vue module, retaining their separate lockfiles. The playground remains independent: run `pnpm --dir playground install --ignore-workspace --frozen-lockfile` before starting it. Use the root scripts below rather than recursive scripts: frontend `build` and `typecheck` need the playground or a generated Inertia workspace, and root checks already delegate to the Vue module.

```bash
pnpm install
pnpm dev            # playground backend
pnpm frontend:dev   # dashboard, in a second terminal
pnpm lint
pnpm typecheck
pnpm test           # backend unit tests (tests/), then the frontend suite
pnpm knip
```

<details>
<summary>Repository notes</summary>

- To build and typecheck the frontend module against the installed DMS, run `pnpm exec ajs dms verify-source -m ../frontend-vue` from `playground/`, or set `DMS_FRONTEND_WORKSPACE` to the workspace generated by `ajs dms prepare` and run `pnpm --dir frontend-vue typecheck`.

</details>

## License

[Apache-2.0](./LICENSE)
