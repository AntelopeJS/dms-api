# Coverage of `smoke`

The journey every verdict runs. The other features carry the detail.

| Source | Documented behaviour | Catching journey and check |
|---|---|---|
| docs/1.introduction.md | The module captures the requests the project's API answers and turns them into a health verdict and request logs under Modules › API | `traffic-shows-in-the-overview-and-the-request-logs`, checks `26 requests are captured`, `the verdict is degraded`, `the Overview` and `the Request logs` |
| docs/1.introduction.md | The Overview answers whether the API is healthy and the hero shows the verdict | same journey, `the Overview`: `Degraded`, `View 1 server error` |
| docs/1.introduction.md | Request logs list every captured request, a request opens with its error | same journey, `the request drawer` |
