import { Card } from "@antelopejs/interface-dms/base/card";
import { ChartLine } from "@antelopejs/interface-dms/base/chart";
import { ChartCard } from "@antelopejs/interface-dms/base/chart-card";
import { Grid, GridRow } from "@antelopejs/interface-dms/base/grid";
import { Guard } from "@antelopejs/interface-dms/base/guard";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { StatGroup } from "@antelopejs/interface-dms/base/stat-group";
import { Tab } from "@antelopejs/interface-dms/base/tab";
import { TopListCard } from "@antelopejs/interface-dms/base/top-list-card";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { getConfig } from "@/config";
import { ROUTE_TABS } from "@/services/links";
import { LIVE_REQUESTS_TOPIC } from "@/types";
import { apiBlock } from "./blocks";
import { exploreCategory } from "./module";
import { PERIOD_SCOPE, periodSelector } from "./period";
import { liveMode, pageToolbar } from "./toolbar";
import { requestTable } from "./request-table";
import { scopeChip } from "./scope-chip";

const ROUTES_API = "/api/monitoring/routes";
const DETAIL_URL = `${ROUTES_API}/detail`;

/** Query parameter holding the selected route, as `METHOD /path`. */
const ROUTE_QUERY_KEY = "route";

/** Query parameter holding the open tab, by its slot (`?tab=tester`). */
const TAB_QUERY_KEY = "tab";

/** A route statistic of the page's period, read for the route the URL names. */
function statisticsUrl(name: string): string {
  return `${ROUTES_API}/statistics/${name}?route={{query.${ROUTE_QUERY_KEY}}}`;
}

const RECENT_REQUESTS = 6;
const MS_PER_SECOND = 1000;

/** Narrowest a chart stays readable at beside the other one. */
const CHART_MIN_WIDTH = "340px";

/** A row of the Statistics tab's grid holding one block, as wide as the tab. */
const FULL_WIDTH = { colSpan: 2 };

/**
 * Calls, latency with its p95, error rate and slowest call of the route over
 * the page's period, as one DMS StatGroup strip. A route without a call over
 * the period never shows it: the tab's guard stands in for it.
 */
function summaryRow() {
  return GridRow()
    .child(
      "summary",
      StatGroup({
        fetchUrl: statisticsUrl("summary"),
        periodScope: PERIOD_SCOPE,
        realtimeTopic: LIVE_REQUESTS_TOPIC,
        layout: "joined",
        columns: 4,
        skeletonCount: 4,
        label: "$api.routes.statistics.title",
      }).meta({ name: "$api.routes.statistics.summary", icon: "i-ph-gauge" }),
      FULL_WIDTH,
    )
    .meta({ name: "$api.routes.statistics.summary" });
}

/**
 * The slow threshold as the console writes it ("800 ms", "1 s", "1.5 s",
 * `formatThreshold` in the frontend): a chart annotation is drawn as sent,
 * untranslated.
 */
export function thresholdLabel(ms: number): string {
  if (ms < MS_PER_SECOND) return `${Math.round(ms)} ms`;
  return `${Math.round((ms / MS_PER_SECOND) * 100) / 100} s`;
}

/**
 * The p95 as dots on its line: a bucket between quiet ones is a lone point,
 * which a line alone would not draw. Average, Max, p95: the order of
 * `/statistics/latency-chart`.
 */
const LATENCY_MARKERS = {
  key: "markers",
  value: JSON.stringify({
    size: [0, 0, 3],
    strokeWidth: 0,
    hover: { size: 5 },
  }),
};

/**
 * Response time against the slow threshold: a dashed line at the threshold
 * in force when the page is served, always within the axis (a route slower
 * than it all along is the one it matters on), and straight segments between
 * the busy buckets only, so a quiet hour is a gap rather than a line drawn
 * across it.
 */
function latencyChart() {
  return ChartLine({
    height: "220px",
    xaxisType: "datetime",
    curve: "straight",
    // Average, Max, p95: three hues apart (info and primary are both cyan).
    color: ["info", "neutral", "secondary"],
    autoYRange: {},
    legendPosition: "top",
    rawOptions: [LATENCY_MARKERS],
  }).onFilter((_permissions, options) => {
    const slowMs = getConfig().requestSlownessThreshold;
    return {
      ...options,
      annotations: [
        {
          y: slowMs,
          label: `≥ ${thresholdLabel(slowMs)}`,
          color: "warning",
          dashed: true,
        },
      ],
    };
  });
}

function chartRow() {
  return GridRow()
    .child(
      "status",
      ChartCard({
        title: "$api.routes.statistics.error_rate_chart",
        icon: "i-ph-chart-line",
        fetchUrl: statisticsUrl("status"),
        periodScope: PERIOD_SCOPE,
        valueFormat: "percent",
        valuePrecision: 1,
        // A rate's change in points, bad when up: the DMS badge would show it
        // as a relative change, green. The "vs" figure stays (DMS-12).
        showDelta: false,
        showLegend: true,
        // Names the 4xx and the 5xx lines, which the period legend does not.
        showSeriesLegend: true,
        // 4xx and 5xx as a share of each bucket's calls: an incident reads
        // whatever the volume around it.
        chart: ChartLine({
          height: "220px",
          xaxisType: "datetime",
          curve: "straight",
          color: ["warning", "error"],
          legendPosition: "top",
        }),
      }),
    )
    .child(
      "latency",
      ChartCard({
        title: "$api.routes.statistics.response_time",
        icon: "i-ph-timer",
        fetchUrl: statisticsUrl("latency-chart"),
        periodScope: PERIOD_SCOPE,
        valueFormat: "number",
        // Whole milliseconds: the axis spreads its ticks evenly between the
        // bounds autoYRange widens to the threshold, fractions otherwise
        // ("881.664"). The threshold keeps the range wide enough for whole
        // numbers never to repeat.
        valuePrecision: 0,
        showDelta: false,
        showLegend: true,
        // Names the Average, Max and p95 lines.
        showSeriesLegend: true,
        chart: latencyChart(),
      }),
    )
    .meta({ name: "$api.routes.statistics.charts" });
}

function errorRow() {
  return GridRow()
    .child(
      "errors",
      TopListCard({
        title: "$api.routes.statistics.top_errors",
        description: "$api.routes.statistics.top_errors_description",
        fetchUrl: statisticsUrl("errors"),
        periodScope: PERIOD_SCOPE,
        valueFormat: "number",
        showBar: true,
        showRank: false,
        showDelta: false,
        skeletonCount: 3,
        emptyLabel: "$api.routes.statistics.no_errors",
      }),
      FULL_WIDTH,
    )
    .meta({ name: "$api.routes.statistics.top_errors" });
}

/** The latest requests of the route over the page's period. */
function recentRow() {
  return GridRow()
    .child(
      "requests",
      Card({
        title: "$api.routes.statistics.recent",
        padded: false,
      })
        .child(
          "table",
          requestTable({
            page: "routes",
            fetchUrl: "/api/monitoring/logs/routes",
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
      FULL_WIDTH,
    )
    .meta({ name: "$api.routes.statistics.recent" });
}

/**
 * The Statistics tab: DMS blocks reading the route of the URL through
 * `{{query.route}}`, over the page's period, on a two-column grid: the
 * charts side by side, the rest across. A DMS `Guard` stands in for them
 * while the route has no call over the period: one empty state rather than
 * a tab of empty blocks, whose answer (`/statistics/activity`) says whether
 * the route was ever called and leads to its Tester.
 */
function routeStatistics() {
  return Guard({
    fetchUrl: statisticsUrl("activity"),
    periodScope: PERIOD_SCOPE,
    realtimeTopic: LIVE_REQUESTS_TOPIC,
    when: "empty",
    field: "calls",
    fallback: {
      icon: "i-ph-moon-stars",
      title: "$api.routes.statistics.idle_title",
      description: "$api.routes.statistics.idle_description",
    },
  })
    .child(
      "grid",
      Grid({ gap: "1rem", minColumnWidth: CHART_MIN_WIDTH })
        .child("summary", summaryRow())
        .child("charts", chartRow())
        .child("detail", errorRow())
        .child("recent", recentRow())
        .meta({ name: "$api.routes.statistics.title", icon: "i-ph-chart-bar" }),
    )
    .meta({ name: "$api.routes.statistics.title", icon: "i-ph-chart-bar" });
}

/**
 * Routes: every registered route in a list, the selected one beside it (under
 * it on a phone) with its statistics, its contract and a tester. The route
 * and the tab live in the URL, so both can be linked to, and so does the
 * period (`?api.period=last-24h`, the DMS PeriodSelector's). The tabs wait for
 * a route that exists.
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
    // Direct / Pause over the live feed, each block read at most every 15 s,
    // every minute over a week or a month.
    live: liveMode(15, 60),
  },
  DefaultLayout(),
) {
  // The toolbar of every monitoring page (`pageToolbar`).
  static toolbar = pageToolbar({
    scope: scopeChip(),
    period: periodSelector({ compare: true }),
  }).meta({ name: "$api.routes.toolbar", icon: "i-ph-sliders-horizontal" });

  static explorer = apiBlock("SplitLayout", {
    asideWidth: "340px",
    detailUrl: DETAIL_URL,
    queryKey: ROUTE_QUERY_KEY,
  })
    .child(
      "tree",
      apiBlock("RouteTree", {
        fetchUrl: `${ROUTES_API}/list`,
        queryKey: ROUTE_QUERY_KEY,
        realtimeTopic: LIVE_REQUESTS_TOPIC,
        // The header below, by its key path: the list scrolls to it on a phone.
        detailBlock: "explorer.header",
      }),
      { slot: "aside" },
    )
    .child(
      "header",
      apiBlock("RouteHeader", {
        fetchUrl: DETAIL_URL,
        queryKey: ROUTE_QUERY_KEY,
        tabKey: TAB_QUERY_KEY,
        statisticsTab: ROUTE_TABS.statistics,
        testerTab: ROUTE_TABS.tester,
        realtimeTopic: LIVE_REQUESTS_TOPIC,
      }),
    )
    .child(
      "tabs",
      Tab({
        items: [
          {
            label: "$api.routes.tabs.statistics",
            slot: ROUTE_TABS.statistics,
            icon: "i-ph-chart-bar",
          },
          {
            label: "$api.routes.tabs.documentation",
            slot: ROUTE_TABS.documentation,
            icon: "i-ph-book-open-text",
            badge: "$api.routes.tabs.beta",
          },
          {
            label: "$api.routes.tabs.tester",
            slot: ROUTE_TABS.tester,
            icon: "i-ph-paper-plane-tilt",
          },
        ],
        variant: "link",
        color: "primary",
        persistState: true,
        stateKey: TAB_QUERY_KEY,
      })
        .child("statistics", routeStatistics(), { slot: ROUTE_TABS.statistics })
        .child(
          "documentation",
          apiBlock("RouteDocumentation", {
            fetchUrl: DETAIL_URL,
            queryKey: ROUTE_QUERY_KEY,
          }),
          { slot: ROUTE_TABS.documentation },
        )
        .child(
          "tester",
          apiBlock("RouteTester", {
            fetchUrl: DETAIL_URL,
            queryKey: ROUTE_QUERY_KEY,
          }),
          { slot: ROUTE_TABS.tester },
        )
        .meta({ name: "$api.routes.tabs.name", icon: "i-ph-tabs" }),
      // Shown once the URL names a route that exists.
      { slot: "route" },
    )
    .meta({ name: "$api.routes.explorer", icon: "i-ph-tree-structure" });
}
