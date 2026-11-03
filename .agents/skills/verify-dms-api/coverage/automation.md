# Coverage: automation

| Source | Documented behaviour | Journey | Check |
|---|---|---|---|
| docs/5.extending.md (Automation nodes) | Without `@antelopejs/dms-automation` the registration is a silent no-op | `without-the-automation-module-the-registration-is-a-silent-no-op` | `the log says the optional automation interface has no provider`, `no error line names the automation nodes`, `no line says dms-api failed`, `the console answers` |
| docs/5.extending.md (Route unhealthy trigger) | `api.route-unhealthy` fires when a route enters a bad state, config `intervalSeconds` (default 60, min 10) and `flags` (default broken, slow), output fields; runs on one node of a cluster | Not driven: the playground does not load `@antelopejs/dms-automation` (no published provider is pinned in the campaign tarballs) |
| docs/5.extending.md (Get API health action) | `api.get-api-health` returns the KPIs of the routes in scope and a status breakdown; the optional `days` input | Not driven: same reason. The KPIs it reads are asserted through the Overview's routes |
| docs/5.extending.md (Query request logs action) | `api.query-request-logs` reads captured requests under the active scope with its inputs and a cursor | Not driven: same reason. The scope and the filters it reuses are asserted through the logs routes |
