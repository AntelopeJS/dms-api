# Coverage: access

| Source | Documented behaviour | Journey | Check |
|---|---|---|---|
| docs/5.extending.md (Role permissions) | Every block is a permission of its own, guarded with `@AuthUserWithPermission(<block>)` | `every-console-route-needs-a-session-and-the-block-it-serves` | all 28 routes answer 401 without a session and 403 naming the missing permission to a member with none |
| docs/5.extending.md (Role permissions) | Give a role the Request logs without the Tester, or the Overview only | `a-role-opens-the-blocks-it-holds-and-no-others` | a role holding the logs table opens only `GET /logs`; a role holding the Tester opens only its token |
| docs/5.extending.md (Role permissions) | The settings summary is for the owner | `every-console-route-needs-a-session-and-the-block-it-serves` | `GET /settings/summary` is 403 for a member and passes for the owner |
| docs/4.usage/4.settings.md (intro) | Module pages are the owner's | Not driven: the pages' own redirect for a member is not asserted; the routes' answers are |
| src/services/request-log/access.ts (TSDoc) | A panel opened from one table reads only a request that table can list; a request out of reach is a 404 | Not driven: needs a member with the Overview's recent-requests permission and an out-of-scope request |
