import { ActivityFeed } from "@antelopejs/interface-dms/base/activity-feed";
import { Card } from "@antelopejs/interface-dms/base/card";
import { ChartColumn } from "@antelopejs/interface-dms/base/chart";
import { ChartCard } from "@antelopejs/interface-dms/base/chart-card";
import { Grid, GridRow } from "@antelopejs/interface-dms/base/grid";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { logsLink } from "@/services/links";
import { apiBlock } from "./blocks";
import { monitorCategory } from "./module";
import {
  blockClientId,
  followsLive,
  liveBanner,
  liveControl,
  pageToolbar,
} from "./live";
import { requestDrawerHost, requestTable } from "./request-table";
import { scopeChip } from "./scope-chip";

const OVERVIEW_API = "/api/monitoring/overview";

/** Scope of the period every card of the page follows. */
const OVERVIEW_PERIOD = "api-overview";

/**
 * The page's period when neither its URL nor the tab names one: the last
 * 24 hours, as on the request logs and Routes.
 */
export const OVERVIEW_DEFAULT_WINDOW = "24h";

const RECENT_REQUESTS = 6;

const ACTIVITY_ROWS = 8;

/**
 * The DMS blocks of the dashboard that stay live while Recent requests holds
 * (a request open, Load more, a search): the charts and the activity. Each
 * follows the live mode by itself (`followsLive`).
 */
const LIVE_BLOCKS = [
  blockClientId("dashboard", "health", "errorShare"),
  blockClientId("dashboard", "traffic", "chart"),
  blockClientId("dashboard", "recent", "activity"),
];

/**
 * The DMS hides the legend of a chart nested in a `ChartCard` (it draws only
 * its "Period / Comparison" key), so a chart of several series names them
 * through its raw ApexCharts options, which replace that setting.
 */
const SERIES_LEGEND = {
  key: "legend",
  value: JSON.stringify({
    show: true,
    position: "top",
    horizontalAlign: "left",
    fontSize: "12px",
    markers: { size: 5, shape: "square", strokeWidth: 0 },
    itemMargin: { horizontal: 8 },
  }),
};

/**
 * Overview: is the API healthy, and where to look when it is not. The health
 * hero leads, what needs a look comes right under it, then the trends; every
 * row drills down to a route or to its requests.
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
  },
  DefaultLayout(),
) {
  // Opens the request a recent row asks for, from the right; draws nothing.
  static requestDrawer = requestDrawerHost();

  // The toolbar of every monitoring page, Beta right of the scope. The
  // period lives in the URL (`?window=24h`): the DMS PeriodSelector keeps
  // its own in memory, so `PeriodWindow` drives the cards' period scope.
  static toolbar = pageToolbar({
    scope: scopeChip(),
    badge: apiBlock("BetaBadge"),
    live: liveControl({
      page: "overview",
      sinceUrl: "/api/monitoring/logs/recent/since",
      defaultWindow: OVERVIEW_DEFAULT_WINDOW,
      healthUrl: `${OVERVIEW_API}/health`,
      liveBlocks: LIVE_BLOCKS,
    }),
    period: apiBlock("PeriodWindow", {
      scope: OVERVIEW_PERIOD,
      defaultWindow: OVERVIEW_DEFAULT_WINDOW,
    }),
  }).meta({ name: "$api.overview.toolbar", icon: "i-ph-sliders-horizontal" });

  static health = apiBlock("HealthHero", {
    fetchUrl: `${OVERVIEW_API}/health`,
  });

  // The rows keep their ids whatever their order: the endpoints check their
  // permission by them (`src/routes/overview.ts`).
  static dashboard = Grid({ gap: "1rem", minColumnWidth: "300px" })
    .child(
      "health",
      GridRow()
        .child(
          "attention",
          apiBlock("AttentionList", {
            fetchUrl: `${OVERVIEW_API}/attention`,
            errorsLink: logsLink({
              tab: "5xx",
              window: "24h",
              from: "overview",
            }),
          }),
        )
        .child(
          "slowest",
          apiBlock("OverviewTopList", {
            kind: "slowest",
            fetchUrl: `${OVERVIEW_API}/slowest`,
            periodScope: OVERVIEW_PERIOD,
          }).meta({ name: "$api.overview.slowest.title", icon: "i-ph-timer" }),
        )
        .child(
          "errorShare",
          followsLive(
            ChartCard({
              title: "$api.overview.error_share.title",
              // Shown in place of the "vs" figure, so only when there is none.
              description: "$api.overview.no_previous",
              icon: "i-ph-warning-diamond",
              fetchUrl: `${OVERVIEW_API}/error-share`,
              periodScope: OVERVIEW_PERIOD,
              valueFormat: "percent",
              valuePrecision: 1,
              // The DMS badge reads a delta as a relative change, good when up:
              // a rate's change in points, bad when up, would read wrong. The
              // "vs" figure stays (DMS-12).
              showDelta: false,
              showLegend: false,
              chart: ChartColumn({
                height: "220px",
                xaxisType: "datetime",
                stacked: true,
                color: ["warning", "error"],
                rawOptions: [SERIES_LEGEND],
              }),
            }),
          ),
        ),
    )
    .child(
      "traffic",
      GridRow()
        .child(
          "chart",
          followsLive(
            ChartCard({
              title: "$api.overview.traffic.title",
              description: "$api.overview.no_previous",
              icon: "i-ph-chart-bar",
              fetchUrl: `${OVERVIEW_API}/traffic`,
              periodScope: OVERVIEW_PERIOD,
              valueFormat: "compact",
              showLegend: false,
              // 2xx, 4xx and 5xx stacked on one axis: the height of a column
              // is the traffic, its red part the server errors.
              chart: ChartColumn({
                height: "260px",
                xaxisType: "datetime",
                stacked: true,
                color: ["success", "warning", "error"],
                rawOptions: [SERIES_LEGEND],
              }),
            }),
          ),
          { colSpan: 2 },
        )
        .child(
          "classes",
          apiBlock("OverviewTopList", {
            kind: "classes",
            fetchUrl: `${OVERVIEW_API}/classes`,
            periodScope: OVERVIEW_PERIOD,
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
            .child("live", liveBanner({ pageSize: RECENT_REQUESTS }))
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
          followsLive(
            ActivityFeed({
              title: "$api.overview.activity.title",
              fetchUrl: `${OVERVIEW_API}/activity`,
              groupByDay: true,
              maxItems: ACTIVITY_ROWS,
              fillHeight: true,
              skeletonCount: 4,
              empty: { title: "$api.overview.activity.empty" },
            }),
          ).meta({
            name: "$api.overview.activity.title",
            icon: "i-ph-clock-counter-clockwise",
          }),
        ),
    )
    .meta({ name: "$api.overview.dashboard", icon: "i-ph-squares-four" });
}
