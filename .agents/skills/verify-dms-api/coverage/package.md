# Coverage: package

| Source | Documented behaviour | Journey | Check |
|---|---|---|---|
| docs/2.installation.md (Add the module) | The `dms-api` entry installs `@antelopejs/dms-api` from a version range | `the-ranges-and-the-skill-match-what-the-docs-name` | `this version is inside the range the installation docs show` |
| docs/1.introduction.md (Requirements) | The renderer range declared in `engines["@antelopejs/dms-frontend"]` of the Vue layer | same | `the renderer installed is inside the Vue layer's engines range` |
| README.md (Compatibility) | The compatibility table lists the interface dependencies | same | `the README table lists each interface dependency` |
| README.md (Documentation) and docs links | Every console link points at a page that exists | `the-docs-links-and-the-two-locales-are-complete` | `every page exists`, `no console link points at a missing page` |
| README.md | The package ships the `dms-api` skill declared under `antelopeJs.skills` | `the-tarball-holds-what-the-manifest-names`; `the-ranges-and-the-skill-match-what-the-docs-name` | `the skills folder is declared`, `the skill is packed`, the skill's frontmatter and nodes, the cases file |
| docs/2.installation.md (Restart the backend) | The module registers its Vue frontend module when it starts | `the-tarball-holds-what-the-manifest-names` | `the frontend module is declared`, `the frontend module is packed`; the registration at start is exercised by every browser journey |
| package.json | `dist` entry, the shipped folders, no sources, tests or playground | same | `main`, `the shipped folders`, `nothing else but the manifest, licence and readme`, `no source, test or playground file is packed` |
| frontend-vue/i18n | English and French locale files hold the same keys | `the-docs-links-and-the-two-locales-are-complete` | both directions |
| docs/2.installation.md (Try it with traffic) | The playground sends demo traffic | Not driven: `pnpm --dir playground traffic` is developer tooling |
| docs/2.installation.md (Open the console) | `/modules/api` redirects to the Overview | Not driven: the redirect of the bare module path is not asserted (the Overview, Request logs, Routes and Settings paths are) |
