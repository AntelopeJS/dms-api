import { Card } from "@antelopejs/interface-dms/base/card";
import { ChartColumn, ChartLine } from "@antelopejs/interface-dms/base/chart";
import { ChartCard } from "@antelopejs/interface-dms/base/chart-card";
import { Grid, GridRow } from "@antelopejs/interface-dms/base/grid";
import { KpiCard } from "@antelopejs/interface-dms/base/kpi-card";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PeriodSelector } from "@antelopejs/interface-dms/base/period-selector";
import { HStack, Spacer } from "@antelopejs/interface-dms/base/stack";
import { Tab } from "@antelopejs/interface-dms/base/tab";
import { TopListCard } from "@antelopejs/interface-dms/base/top-list-card";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { apiBlock } from "./blocks";
import { exploreCategory } from "./module";
import { requestTable } from "./request-table";
import { scopeChip } from "./scope-chip";

const ROUTES_API = "/api/monitoring/routes";

/** Scope of the period selector the Statistics tab follows. */
const ROUTES_PERIOD = "api-routes";

/** Query parameter holding the selected route, as `METHOD /path`. */
const ROUTE_QUERY_KEY = "route";

/** A route statistic of the page's period, read for the route the URL names. */
function statisticsUrl(name: string): string {
  return `${ROUTES_API}/statistics/${name}?route={{query.${ROUTE_QUERY_KEY}}}`;
}

const RECENT_REQUESTS = 6;

function kpi(name: string, options: Parameters<typeof KpiCard>[0]) {
  return KpiCard({
    variant: "stat",
    fetchUrl: statisticsUrl(name),
    periodScope: ROUTES_PERIOD,
    showDelta: true,
    ...options,
  } as Parameters<typeof KpiCard>[0]);
}

function kpiRow() {
  return GridRow()
    .child(
      "requests",
      kpi("requests", {
        icon: "i-ph-arrows-left-right",
        title: "$api.routes.statistics.requests",
        valueFormat: "compact",
      }),
    )
    .child(
      "latency",
      kpi("latency", {
        icon: "i-ph-timer",
        title: "$api.routes.statistics.average_ms",
        valueFormat: "number",
        invert: true,
      }),
    )
    .child(
      "errorRate",
      kpi("error-rate", {
        icon: "i-ph-warning-diamond",
        title: "$api.routes.statistics.error_rate",
        valueFormat: "percent",
        valuePrecision: 1,
        invert: true,
      }),
    )
    .child(
      "maxLatency",
      kpi("max-latency", {
        icon: "i-ph-gauge",
        title: "$api.routes.statistics.max_ms",
        valueFormat: "number",
        invert: true,
      }),
    );
}

function chartRow() {
  return GridRow()
    .child(
      "status",
      ChartCard({
        title: "$api.routes.statistics.by_status",
        icon: "i-ph-chart-bar",
        fetchUrl: statisticsUrl("status"),
        periodScope: ROUTES_PERIOD,
        valueFormat: "compact",
        showLegend: true,
        chart: ChartColumn({
          height: "220px",
          xaxisType: "datetime",
          stacked: true,
          color: ["success", "warning", "error"],
        }),
      }),
      { colSpan: 2 },
    )
    .child(
      "latency",
      ChartCard({
        title: "$api.routes.statistics.response_time",
        icon: "i-ph-timer",
        fetchUrl: statisticsUrl("latency-chart"),
        periodScope: ROUTES_PERIOD,
        valueFormat: "number",
        showDelta: false,
        showLegend: true,
        chart: ChartLine({
          height: "220px",
          xaxisType: "datetime",
          smooth: true,
          color: ["info", "warning", "neutral"],
        }),
      }),
      { colSpan: 2 },
    );
}

function errorRow() {
  return GridRow().child(
    "errors",
    TopListCard({
      title: "$api.routes.statistics.top_errors",
      description: "$api.routes.statistics.top_errors_description",
      fetchUrl: statisticsUrl("errors"),
      periodScope: ROUTES_PERIOD,
      valueFormat: "number",
      showBar: true,
      showRank: false,
      showDelta: false,
      skeletonCount: 3,
      emptyLabel: "$api.routes.statistics.no_errors",
    }),
    { colSpan: 4 },
  );
}

function recentRow() {
  return GridRow().child(
    "requests",
    Card({
      title: "$api.routes.statistics.recent",
      padded: false,
    })
      .child(
        "table",
        requestTable({
          columns: ["timestamp", "status", "path", "responseTimeMs"],
          sizes: { timestamp: 116, status: 84, path: 180 },
          layout: "compact",
          pageSize: RECENT_REQUESTS,
          pagination: "loadMore",
          density: "compact",
          emptyStates: {
            firstRun: {
              title: "$api.routes.statistics.no_calls_title",
              description: "$api.routes.statistics.no_calls_description",
              icon: "i-ph-list-magnifying-glass",
            },
          },
        }).meta({
          name: "$api.routes.statistics.recent",
          icon: "i-ph-list-magnifying-glass",
        }),
      )
      .meta({
        name: "$api.routes.statistics.recent",
        icon: "i-ph-list-magnifying-glass",
      }),
    { colSpan: 4 },
  );
}

/**
 * The Statistics tab: DMS blocks reading the route of the URL through
 * `{{query.route}}`, over the page's period. Without a route in the URL they
 * request nothing and stay empty.
 */
function routeStatistics() {
  return Grid({ gap: "1rem", minColumnWidth: "160px" })
    .child("kpis", kpiRow())
    .child("charts", chartRow())
    .child("detail", errorRow())
    .child("recent", recentRow())
    .meta({ name: "$api.routes.statistics.title", icon: "i-ph-chart-bar" });
}

/**
 * Routes: every registered route on the left, the selected one on the right
 * with its statistics, its contract and a tester. The route and the tab live
 * in the URL, so both can be linked to.
 */
@RegisterPage()
export class RoutesPage extends PageController(
  "routes",
  {
    displayName: "$api.routes.title",
    description: "$api.routes.description",
    icon: "i-ph-tree-structure",
    module: "api",
    category: exploreCategory,
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
        id: ROUTES_PERIOD,
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
    .meta({ name: "$api.routes.toolbar", icon: "i-ph-sliders-horizontal" });

  static explorer = apiBlock("SplitLayout", { asideWidth: "340px" })
    .child(
      "tree",
      apiBlock("RouteTree", {
        fetchUrl: `${ROUTES_API}/list`,
        queryKey: ROUTE_QUERY_KEY,
      }),
      { slot: "aside" },
    )
    .child(
      "header",
      apiBlock("RouteHeader", {
        fetchUrl: `${ROUTES_API}/detail`,
        queryKey: ROUTE_QUERY_KEY,
      }),
    )
    .child(
      "tabs",
      Tab({
        items: [
          {
            label: "$api.routes.tabs.statistics",
            slot: "statistics",
            icon: "i-ph-chart-bar",
          },
          {
            label: "$api.routes.tabs.documentation",
            slot: "documentation",
            icon: "i-ph-book-open-text",
          },
          {
            label: "$api.routes.tabs.tester",
            slot: "tester",
            icon: "i-ph-paper-plane-tilt",
          },
        ],
        variant: "link",
        color: "primary",
        persistState: true,
        stateKey: "tab",
      })
        .child("statistics", routeStatistics(), { slot: "statistics" })
        .child(
          "documentation",
          apiBlock("RouteDocumentation", {
            fetchUrl: `${ROUTES_API}/detail`,
            queryKey: ROUTE_QUERY_KEY,
          }),
          { slot: "documentation" },
        )
        .child(
          "tester",
          apiBlock("RouteTester", {
            fetchUrl: `${ROUTES_API}/detail`,
            queryKey: ROUTE_QUERY_KEY,
          }),
          { slot: "tester" },
        )
        .meta({ name: "$api.routes.tabs.name", icon: "i-ph-tabs" }),
    )
    .meta({ name: "$api.routes.explorer", icon: "i-ph-tree-structure" });
}
