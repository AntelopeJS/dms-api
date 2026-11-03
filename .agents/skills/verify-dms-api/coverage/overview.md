# Coverage: overview

| Source | Documented behaviour | Journey | Check |
|---|---|---|---|
| docs/4.usage/1.overview.md | The hero shows the verdict (Healthy, Degraded or Down) | the six verdict journeys | `the hero` page text per verdict; `the verdict` in the API |
| docs/4.usage/1.overview.md | Degraded from 1% of server errors over 15 minutes | `one-failing-call-in-a-hundred-is-degraded`; `one-failing-call-in-a-hundred-and-one-is-operational` | 1 in 100 reads degraded, 1 in 101 reads operational (Healthy) |
| docs/4.usage/1.overview.md | Down from 20% over 5 minutes | `a-fifth-of-the-calls-failing-is-down`; `nineteen-percent-failing-is-degraded-not-down` | 20 in 100 reads down, 19 in 100 reads degraded |
| docs/4.usage/1.overview.md | The four signals: 5xx rate, p95 latency, traffic, 4xx rate | verdict journeys | `the 5xx rate` (API); the hero text names `5xx · 15 min` only in the idle case |
| src/services/health-rules.ts (TSDoc) | A rate is only read over 20 calls or more | `nineteen-failing-calls-are-too-few-to-judge` | 19 failing calls read operational |
| src/services/health-rules.ts (TSDoc) | No call reads No traffic | `with-no-traffic-the-verdict-is-idle` | `the hero` reads `No traffic` |
| docs/4.usage/1.overview.md | A sentence names the routes above the thresholds; View server errors opens the Request logs narrowed | `the-blocks-rank-the-routes-by-what-is-wrong-with-them` | `1 route failing 1 slow route (≥ 50 ms)`, `View 25 server errors`, `a row opens the logs on the route's 5xx` |
| docs/4.usage/1.overview.md | Needs attention lists failing (5xx), slow (p95 at or above the threshold) and noisy (many 4xx) routes with their main error | same | `attention rows and states, most urgent first`, `the failing route's facts`, `the slow route's p95 and average`, `the noisy route's client error rate`, page text per row |
| docs/4.usage/1.overview.md | Slowest routes ranked by average latency with p95, max and call count | same | `slowest routes start with the slowest`, `slowest routes list the four routes`, page text `p95 81 ms · max 81 ms · 25 calls` |
| docs/4.usage/1.overview.md | Error share is the share of 4xx and 5xx over the period | same | `the error share is 50 of 105 calls` |
| docs/4.usage/1.overview.md | Traffic & errors: calls over time with errors | same | `the traffic block counts 105 calls` |
| docs/4.usage/1.overview.md | Responses by class: calls per status class | same | `the status classes (2xx, 4xx, 5xx)` values and shares |
| docs/4.usage/1.overview.md | The health verdict and Needs attention judge the last 24 hours whatever the period | Not driven: the journeys cannot age traffic by hours; the verdict windows are exercised at 15 and 5 minutes |
| docs/4.usage/1.overview.md | Every route is a link into Routes; a request opens in a drawer; an incident opens the logs on its range (`?since=&until=`) | `the-blocks-rank-the-routes-by-what-is-wrong-with-them` (rows link to the logs narrowed by route and tab), the Overview's route links are `GET /fx/...` anchors; the incident range link is Not driven: it needs an ended incident, which takes 15 minutes of quiet |
| docs/4.usage/1.overview.md | The page toolbar is shared: scope chip, updated ago, Live/Pause, period, comparison | `the-period-and-the-comparison-are-kept-in-the-url-and-shared-by-the-pages` | `the default`, `7D`, `1H`, `30D` |
| docs/4.usage/1.overview.md | The period selector 1H, 24H, 7D, 30D; the URL keeps `?api.period=` | same | `the URL names the period` for each preset |
| docs/4.usage/1.overview.md | vs previous period (default) and No comparison drop the dashed line, delta and "vs" figure | same | `the API honours the comparison`: window comparison, one more series, none after No comparison; `No comparison` menu URL `api.compare=none` |
| docs/4.usage/1.overview.md | A comparison reaching beyond the retention compares with nothing rather than zeros | Not driven: needs retention 30 days and a 30D period against seeded history; the FAQ line is listed under settings |
| docs/4.usage/1.overview.md | The period is kept in the URL and, without one, a page opens on the last choice made on any of the three pages | same | `the Request logs open on the last choice`, `Routes open on the last choice` |
| docs/4.usage/1.overview.md | The scope chip shows the routes the console watches | `the-scope-decides-which-routes-and-requests-every-page-watches` (settings) | `the scope chip` |
| docs/4.usage/1.overview.md | Live: the page follows new requests; each block reads at most every 5 s (logs), 10 s (Overview), 15 s (Routes) | Not driven: read intervals are not observable without a clock; the realtime announcement is observed by `pause-holds-the-table-and-counts-what-was-missed` |
| docs/4.usage/1.overview.md | Paused: nothing is read; the toggle says what was missed; tables offer "N new requests · M in 5xx · Show"; resuming reads once | `pause-holds-the-table-and-counts-what-was-missed` (logs) | `paused`, `shown` |
| docs/4.usage/1.overview.md | The page pauses by itself while the tab is hidden and while typing in the Tester; a table holds its rows while one is open | Not driven: visibility and typing focus are not set by the harness |
| docs/4.usage/1.overview.md | `?live=0` opens a page paused | `the-period-and-the-comparison-are-kept-in-the-url-and-shared-by-the-pages` | `?live=0` |
| docs/4.usage/1.overview.md | `L` toggles Live/Pause | Not driven: the keyboard shortcut is checked by no journey |
