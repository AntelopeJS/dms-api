import { ActivityFeed } from "@antelopejs/interface-dms/base/activity-feed";
import { Card } from "@antelopejs/interface-dms/base/card";
import { ChartColumn } from "@antelopejs/interface-dms/base/chart";
import { ChartCard } from "@antelopejs/interface-dms/base/chart-card";
import { Grid, GridRow } from "@antelopejs/interface-dms/base/grid";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { TopListCard } from "@antelopejs/interface-dms/base/top-list-card";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { logsLink, serverErrorsLink } from "@/services/links";
import { LIVE_REQUESTS_TOPIC } from "@/types";
import { apiBlock } from "./blocks";
import { PERIOD_SCOPE } from "@/services/window";
import { liveMode, monitoringToolbar } from "./toolbar";
import { monitorCategory } from "./module";
import { requestTable } from "./request-table";
import { scopeChip } from "./scope-chip";

const OVERVIEW_API = "/api/monitoring/overview";

const RECENT_REQUESTS = 6;

const ACTIVITY_ROWS = 8;

/** Rows "Needs attention" lists: the route's own cap (`ATTENTION_LIMIT`). */
const ATTENTION_ROWS = 8;

/** Rows "Needs attention" shows before its "Show N more". */
const ATTENTION_VISIBLE_ROWS = 5;

/** Rows of the slowest routes: the route's own cap. */
const SLOWEST_ROWS = 5;

/**
 * Overview: is the API healthy, and where to look when it is not. The verdict
 * leads with its figures, what needs a look comes right under it, then the
 * trends; every row drills down to a route or to its requests. The blocks
 * follow the live feed, which the toolbar's Direct / Pause toggle holds.
 */
@RegisterPage()
export class OverviewPage extends PageController(
  "overview",
  {
    displayName: "$api.overview.title",
    description: "$api.overview.description",
    icon: "i-ph-gauge",
    module: "api",
    category: monitorCategory,
    order: 0,
    // Direct / Pause over the live feed, each block read at most every 10 s,
    // every minute over a week or a month.
    live: liveMode(10, 60),
  },
  DefaultLayout(),
) {
  // The toolbar of every monitoring page. The period selector keeps its
  // period in the URL (`?api.period=last-24h`), against the period before.
  static toolbar = monitoringToolbar({
    leading: {
      scope: scopeChip(),
      // Still in beta: a pill beside the scope, its meaning in a tooltip.
      beta: apiBlock("BetaBadge"),
    },
    compare: true,
  }).meta({ name: "$api.overview.toolbar", icon: "i-ph-sliders-horizontal" });

  // The verdict, since when and why, with the figures it rests on: a DMS
  // Banner and StatGroup cannot give the "since" its tooltip, tell a change
  // of verdict, say the figures are stale, nor mark the browser tab.
  static health = apiBlock("HealthHero", {
    fetchUrl: `${OVERVIEW_API}/health`,
    realtimeTopic: LIVE_REQUESTS_TOPIC,
  });

  // The rows keep their ids whatever their order: the endpoints check their
  // permission by them (`src/routes/overview.ts`).
  static dashboard = Grid({ gap: "1rem", minColumnWidth: "300px" })
    .child(
      "health",
      GridRow()
        .child(
          "attention",
          // Its head counts every route to check (the route's `count`, more
          // than the rows shown when capped) and says the window it covers;
          // each row's top error is its third line. Every row is read whole
          // (`wrap`), so the card grows with them rather than filling its
          // cell, and folds past the first five.
          ActivityFeed({
            title: "$api.overview.attention.title",
            badge: "$api.overview.attention.badge",
            fetchUrl: `${OVERVIEW_API}/attention`,
            groupByDay: false,
            mono: true,
            realtimeTopic: LIVE_REQUESTS_TOPIC,
            maxItems: ATTENTION_ROWS,
            visibleItems: ATTENTION_VISIBLE_ROWS,
            wrap: true,
            skeletonCount: 3,
            actions: [
              {
                label: "$api.overview.attention.all_errors",
                to: serverErrorsLink(),
              },
            ],
            empty: {
              title: "$api.overview.attention.empty_title",
              description: "$api.overview.attention.empty_description",
            },
          }).meta({
            name: "$api.overview.attention.title",
            icon: "i-ph-first-aid-kit",
          }),
        )
        .child(
          "slowest",
          // The average with its unit: "1,931 ms".
          TopListCard({
            title: "$api.overview.slowest.title",
            description: "$api.overview.slowest.description",
            fetchUrl: `${OVERVIEW_API}/slowest`,
            periodScope: PERIOD_SCOPE,
            realtimeTopic: LIVE_REQUESTS_TOPIC,
            valueFormat: "number",
            valuePrecision: 0,
            valueSuffix: " ms",
            showBar: true,
            showRank: false,
            showDelta: false,
            skeletonCount: SLOWEST_ROWS,
            emptyLabel: "$api.overview.slowest.empty",
          }).meta({ name: "$api.overview.slowest.title", icon: "i-ph-timer" }),
        )
        .child(
          "errorShare",
          ChartCard({
            title: "$api.overview.error_share.title",
            // Shown in place of the "vs" figure, so only when there is none.
            description: "$api.overview.no_previous",
            icon: "i-ph-warning-diamond",
            fetchUrl: `${OVERVIEW_API}/error-share`,
            periodScope: PERIOD_SCOPE,
            realtimeTopic: LIVE_REQUESTS_TOPIC,
            valueFormat: "percent",
            valuePrecision: 1,
            // The DMS badge reads a delta as a relative change, good when up:
            // a rate's change in points, bad when up, would read wrong. The
            // "vs" figure stays (DMS-12).
            showDelta: false,
            showLegend: false,
            // Names the 4xx and the 5xx columns.
            showSeriesLegend: true,
            chart: ChartColumn({
              height: "220px",
              xaxisType: "datetime",
              stacked: true,
              color: ["warning", "error"],
              legendPosition: "top",
            }),
          }),
        ),
    )
    .child(
      "traffic",
      GridRow()
        .child(
          "chart",
          ChartCard({
            title: "$api.overview.traffic.title",
            description: "$api.overview.no_previous",
            icon: "i-ph-chart-bar",
            fetchUrl: `${OVERVIEW_API}/traffic`,
            periodScope: PERIOD_SCOPE,
            realtimeTopic: LIVE_REQUESTS_TOPIC,
            valueFormat: "compact",
            showLegend: false,
            // Names the 2xx, 4xx and 5xx parts of each column.
            showSeriesLegend: true,
            // 2xx, 4xx and 5xx stacked on one axis: the height of a column
            // is the traffic, its red part the server errors.
            chart: ChartColumn({
              height: "260px",
              xaxisType: "datetime",
              stacked: true,
              color: ["success", "warning", "error"],
              legendPosition: "top",
            }),
          }),
          { colSpan: 2 },
        )
        .child(
          "classes",
          TopListCard({
            title: "$api.overview.classes.title",
            description: "$api.overview.classes.description",
            fetchUrl: `${OVERVIEW_API}/classes`,
            periodScope: PERIOD_SCOPE,
            realtimeTopic: LIVE_REQUESTS_TOPIC,
            valueFormat: "number",
            showBar: true,
            showRank: false,
            showDelta: false,
            skeletonCount: 3,
            emptyLabel: "$api.overview.classes.empty",
          }).meta({
            name: "$api.overview.classes.title",
            icon: "i-ph-chart-pie-slice",
          }),
        ),
    )
    .child(
      "recent",
      GridRow()
        .child(
          "requests",
          Card({
            title: "$api.overview.recent.title",
            description: "$api.overview.recent.description",
            padded: false,
            actions: [
              {
                label: "$api.overview.recent.open_logs",
                to: logsLink(),
                icon: "i-ph-arrow-right",
              },
            ],
          })
            .child(
              "table",
              requestTable({
                page: "overview",
                fetchUrl: "/api/monitoring/logs/recent",
                // Status and duration before the path, the time last: on a
                // phone the row shows what answered and how fast first.
                columns: [
                  "status",
                  "responseTimeMs",
                  "method",
                  "path",
                  "timestamp",
                ],
                sizes: {
                  status: 84,
                  responseTimeMs: 104,
                  method: 80,
                  path: 180,
                  timestamp: 116,
                },
                layout: "compact",
                pageSize: RECENT_REQUESTS,
                pagination: "loadMore",
                density: "compact",
                emptyStates: {
                  firstRun: {
                    title: "$api.overview.recent.empty_title",
                    description: "$api.overview.recent.empty_description",
                    icon: "i-ph-list-magnifying-glass",
                  },
                },
              }).meta({
                name: "$api.overview.recent.title",
                icon: "i-ph-list-magnifying-glass",
              }),
            )
            .meta({
              name: "$api.overview.recent.title",
              icon: "i-ph-list-magnifying-glass",
            }),
          { colSpan: 2 },
        )
        .child(
          "activity",
          // Grouped by day, each incident at its time: an absolute time does
          // not go stale the way "Just now" did.
          ActivityFeed({
            title: "$api.overview.activity.title",
            fetchUrl: `${OVERVIEW_API}/activity`,
            groupByDay: true,
            realtimeTopic: LIVE_REQUESTS_TOPIC,
            maxItems: ACTIVITY_ROWS,
            fillHeight: true,
            skeletonCount: 4,
            empty: { title: "$api.overview.activity.empty" },
          }).meta({
            name: "$api.overview.activity.title",
            icon: "i-ph-clock-counter-clockwise",
          }),
        ),
    )
    .meta({ name: "$api.overview.dashboard", icon: "i-ph-squares-four" });
}
