# Coverage: access

| Source | Documented behaviour | Journey | Check |
|---|---|---|---|
| docs/5.extending.md (Access) | Each route is guarded with `@AuthUserWithPermission(<block>)` for the block it feeds | `every-console-route-needs-a-session-and-the-block-it-serves` | all 28 routes answer 401 without a session and 403 naming the missing permission to a member with none |
| docs/5.extending.md (Access) | The console is for the owner only: a role cannot be given the console or any block of it | `the-console-is-the-owners-and-a-role-holding-a-block-is-refused` | a role holding the logs table's permission and a role holding the Tester's are refused on every route; the owner opens `GET /logs` and `GET /tester/source` |
| docs/5.extending.md (Access) | The settings summary is for the owner | `every-console-route-needs-a-session-and-the-block-it-serves` | `GET /settings/summary` is 403 for a member and passes for the owner |
| docs/4.usage/4.settings.md (intro) | Module pages are the owner's | Not driven: the pages' own redirect for a member is not asserted; the routes' answers are |
| src/services/request-log/access.ts (TSDoc) | A panel opened from one table reads only a request that table can list; a request out of reach is a 404 | Not driven: needs a member with the Overview's recent-requests permission and an out-of-scope request |
| docs/5.extending.md (Access) | The 403 names that block's permission id | `every-console-route-needs-a-session-and-the-block-it-serves` | each of the 27 routes refuses a member with the exact permission id of its own block (`modules.api.monitor.logs.requests`, `...explore.routes.explorer.tabs.tester` for `/logs/tester` and `/tester/source`, `...configure.settings.form` for the settings routes, and so on); `/settings/summary` answers `Owner-only` |
