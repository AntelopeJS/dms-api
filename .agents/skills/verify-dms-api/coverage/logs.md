# Coverage: logs

| Source | Documented behaviour | Journey | Check |
|---|---|---|---|
| docs/4.usage/2.request-logs.md (intro) | The page lists every captured request, newest first | `the-list-is-newest-first-sorts-and-pages` | `newest first` |
| docs/4.usage/2.request-logs.md (Filter) | The chart shows the requests of the period by status class, for all traffic whatever the table filters | `the-histogram-bars-follow-the-period` | `the totals` per preset, `the bars add up to the requests by class`; page text `6 requests` |
| docs/4.usage/2.request-logs.md (Filter) | Bars: a minute over 1H, 15 minutes over 24H, 2 hours over 7D, 6 hours over 30D and All time, 50 to 120 bars | same | `bar length and count` for the five presets (60, 96, 84, 120, 120 bars) |
| docs/4.usage/2.request-logs.md (Filter) | The chart shows the retention and body cap in use | same | page text `Kept 30 days · bodies up to 64 KB` |
| docs/4.usage/2.request-logs.md (Filter) | A period that reaches now updates live and freezes on Pause; a past range is read once and says it is not live | same; `pause-holds-the-table-and-counts-what-was-missed` | `live while the period reaches now`, `a past range is not live`; `Live` is on, then `Pause` |
| docs/4.usage/2.request-logs.md (Filter) | A length is picked for a custom range | same | `a bar length asked for within the cap is used`, `a bar length beyond the cap is not used` |
| docs/4.usage/2.request-logs.md (Filter) | Tabs All, 2xx, 4xx, 5xx with counts | `the-tabs-the-filters-and-the-search-narrow-the-list` | API totals per class and the tab buttons `All 11`, `2xx 7`, `4xx 2`, `5xx 2`; the 4xx tab shows only the 404s and hides the 500s |
| docs/4.usage/2.request-logs.md (Filter) | Method and Slow narrow the table; the slow filter follows the slow threshold | same | `a method`, `two methods`, `slow follows the threshold`, button `Slow (≥ 50 ms)` then only `/fx/slow` |
| docs/4.usage/2.request-logs.md (Filter) | The period selector adds All time (ALL) and compares nothing | same-feature `the-histogram-bars-follow-the-period` | `All time` page text; no comparison control is asserted absent: Not driven |
| docs/4.usage/2.request-logs.md (Filter) | `/` opens the search; `?` lists the shortcuts | Not driven: keyboard shortcuts; the search itself is driven through the API (`the search matches error words`, `the search matches path words`) |
| docs/4.usage/2.request-logs.md (Open a request) | A click on a row opens the drawer titled with its method and path | `a-request-opens-in-a-drawer-that-steps-through-the-list` | `the newest request` |
| docs/4.usage/2.request-logs.md (Open a request) | Its position over the whole result (`3 of 26,120`); J and K step to the previous and next request | same | `1 of 5`, `Next` to `2 of 5`, `K steps to the next request` (`3 of 5`), `J steps back` |
| docs/4.usage/2.request-logs.md (Open a request) | The URL names it (`?record=<id>`); a link or a reload opens it again | same | `the URL names the record`, `a reload` |
| docs/4.usage/2.request-logs.md (Open a request) | Drag its left edge to widen it: it opens again at that width | Not driven: pointer drag |
| docs/4.usage/2.request-logs.md (Open a request) | Summary: the error and its stack, the general facts, the timing against the route's p50 and p95, the path parameters | same | `Summary`: error message, Route, User agent, Request ID, `500 Internal Server Error`, `Slow threshold 1,000 ms, as set now.` |
| docs/4.usage/2.request-logs.md (Open a request) | Request: the captured headers, query string and body | same | `Request`: `limit 5`, `content-type application/json`, the body |
| docs/4.usage/2.request-logs.md (Open a request) | Response: the status, headers and body | same | `Response` |
| docs/4.usage/2.request-logs.md (Open a request) | Replay in tester opens the route's Tester filled with the request | same | `Replay in tester`: URL `tab=tester&replay=`, the path parameter box, the body |
| docs/4.usage/2.request-logs.md (Open a request) | Copy cURL copies it as a command | Not driven: clipboard |
| docs/4.usage/2.request-logs.md (Open a request) | Same error lists the other requests that failed the same way | same | `Same error`: URL route and error, `All 2` |
| docs/4.usage/2.request-logs.md (note) | Bodies above the cap are stored truncated and flagged; secret-looking values are stored as `[REDACTED]` | feature capture | see coverage/capture.md |
| docs/5.extending.md (Link to the console) | `/modules/api/logs?record=<requestId>` opens a request; `?since=&until=` the requests of a range; `?api.period=` and `?live=0` | `a-request-opens-in-a-drawer-that-steps-through-the-list`; `the-period-and-the-comparison-are-kept-in-the-url-and-shared-by-the-pages` | `a reload`; `?live=0`. `?since=&until=` is Not driven: no incident range exists in a run |
| src/services/request-log/list.ts (TSDoc) | The route filter names the route's method, not the request's; the path filter is the raw path; the error filter is read whole | `the-tabs-the-filters-and-the-search-narrow-the-list` | `the route filter names the route, not the path`, `the path filter is the raw path`, `the error filter` |
| src/services/request-log/list.ts | The list pages by 50 and keeps the total; sorts by time, status and duration | `the-list-is-newest-first-sorts-and-pages` | `the first page holds 50 rows`, `the second page holds the other 10`, `status ascending`, `status descending` |
| src/services/request-log/list.ts | Sorting by duration | Not driven: the seeded rows share one duration; only status and time sorts are asserted |
| docs/4.usage/1.overview.md (Live mode) | "Table on hold · search active" while one row is open or a search is active | Not driven: the hold wording is not asserted |
