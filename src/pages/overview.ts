import { ActivityFeed } from "@antelopejs/interface-dms/base/activity-feed";
import { Banner } from "@antelopejs/interface-dms/base/banner";
import { Card } from "@antelopejs/interface-dms/base/card";
import {
  ChartColumn,
  ChartMixed,
  ChartType,
} from "@antelopejs/interface-dms/base/chart";
import { ChartCard } from "@antelopejs/interface-dms/base/chart-card";
import { Grid, GridRow } from "@antelopejs/interface-dms/base/grid";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PeriodSelector } from "@antelopejs/interface-dms/base/period-selector";
import { HStack, Spacer } from "@antelopejs/interface-dms/base/stack";
import { StatGroup } from "@antelopejs/interface-dms/base/stat-group";
import { TopListCard } from "@antelopejs/interface-dms/base/top-list-card";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { logsLink } from "@/services/links";
import { monitorCategory } from "./module";
import { requestTable } from "./request-table";
import { scopeChip } from "./scope-chip";

const OVERVIEW_API = "/api/monitoring/overview";

/** Scope of the period selector every chart of the page follows. */
const OVERVIEW_PERIOD = "api-overview";

const RECENT_REQUESTS = 6;

/**
 * Overview: is the API healthy, and where to look when it is not. The health
 * hero leads; every row below drills down to a route or to its requests.
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
  static toolbar = HStack({ alignment: "center", spacing: "0.75rem" })
    .child("scope", scopeChip())
    .child("spacer", Spacer())
    .child(
      "period",
      PeriodSelector({
        id: OVERVIEW_PERIOD,
        variant: "segmented",
        presets: ["last-24h", "last-7-days", "last-30-days"],
        presetLabels: {
          "last-24h": "24H",
          "last-7-days": "7D",
          "last-30-days": "30D",
        },
        showRangeLabel: false,
        defaultPreset: "last-7-days",
        comparisons: ["previous-period"],
        defaultComparison: "previous-period",
        size: "sm",
      }),
    )
    .meta({ name: "$api.overview.toolbar", icon: "i-ph-sliders-horizontal" });

  static beta = Banner({
    title: "$api.overview.beta.title",
    description: "$api.overview.beta.description",
    tone: "info",
    size: "sm",
    dismissible: true,
    dismissKey: "dms-api-beta-1",
  });

  static health = Banner({
    fetchUrl: `${OVERVIEW_API}/health`,
  }).meta({ name: "$api.overview.health.verdict", icon: "i-ph-heartbeat" });

  static figures = StatGroup({
    fetchUrl: `${OVERVIEW_API}/health/figures`,
    layout: "joined",
    columns: 4,
    skeletonCount: 4,
    label: "$api.overview.health.figures",
  }).meta({ name: "$api.overview.health.figures", icon: "i-ph-gauge" });

  static dashboard = Grid({ gap: "1rem", minColumnWidth: "300px" })
    .child(
      "traffic",
      GridRow()
        .child(
          "chart",
          ChartCard({
            title: "$api.overview.traffic.title",
            description: "$api.overview.traffic.description",
            icon: "i-ph-chart-line",
            fetchUrl: `${OVERVIEW_API}/traffic`,
            periodScope: OVERVIEW_PERIOD,
            valueFormat: "compact",
            showLegend: false,
            chart: ChartMixed({
              height: "260px",
              xaxisType: "datetime",
              smooth: true,
              color: ["info", "error"],
              seriesDefs: [
                {
                  name: "$api.overview.traffic.requests",
                  type: ChartType.AREA,
                },
                {
                  name: "$api.overview.traffic.errors",
                  type: ChartType.COLUMN,
                },
              ],
              rawOptions: [
                {
                  key: "yaxis",
                  value: JSON.stringify([
                    { min: 0, forceNiceScale: true },
                    { opposite: true, min: 0, forceNiceScale: true },
                  ]),
                },
              ],
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
            periodScope: OVERVIEW_PERIOD,
            valueFormat: "number",
            showBar: true,
            showRank: false,
            showDelta: false,
            skeletonCount: 3,
            emptyLabel: "$api.overview.classes.empty",
          }),
        ),
    )
    .child(
      "health",
      GridRow()
        .child(
          "attention",
          ActivityFeed({
            title: "$api.overview.attention.title",
            fetchUrl: `${OVERVIEW_API}/attention`,
            groupByDay: false,
            mono: true,
            skeletonCount: 3,
            empty: {
              title: "$api.overview.attention.empty_title",
              description: "$api.overview.attention.empty_description",
            },
            actions: [
              {
                label: "$api.overview.attention.all_errors",
                to: logsLink({ tab: "5xx" }),
              },
            ],
          }).meta({
            name: "$api.overview.attention.title",
            icon: "i-ph-first-aid-kit",
          }),
        )
        .child(
          "errorShare",
          ChartCard({
            title: "$api.overview.error_share.title",
            description: "$api.overview.error_share.description",
            icon: "i-ph-warning-diamond",
            fetchUrl: `${OVERVIEW_API}/error-share`,
            periodScope: OVERVIEW_PERIOD,
            valueFormat: "percent",
            valuePrecision: 1,
            showLegend: false,
            chart: ChartColumn({
              height: "220px",
              xaxisType: "datetime",
              stacked: true,
              color: ["warning", "error"],
            }),
          }),
        )
        .child(
          "slowest",
          TopListCard({
            title: "$api.overview.slowest.title",
            description: "$api.overview.slowest.description",
            fetchUrl: `${OVERVIEW_API}/slowest`,
            periodScope: OVERVIEW_PERIOD,
            valueFormat: "number",
            showBar: true,
            showRank: false,
            showDelta: false,
            skeletonCount: 5,
            emptyLabel: "$api.overview.slowest.empty",
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
                fetchUrl: "/api/monitoring/logs/recent",
                columns: [
                  "timestamp",
                  "method",
                  "path",
                  "status",
                  "responseTimeMs",
                ],
                sizes: {
                  timestamp: 116,
                  method: 80,
                  path: 180,
                  status: 84,
                  responseTimeMs: 130,
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
          ActivityFeed({
            title: "$api.overview.activity.title",
            fetchUrl: `${OVERVIEW_API}/activity`,
            groupByDay: false,
            maxItems: 6,
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
