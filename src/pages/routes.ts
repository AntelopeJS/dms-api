import { Card } from "@antelopejs/interface-dms/base/card";
import { ChartLine } from "@antelopejs/interface-dms/base/chart";
import { ChartCard } from "@antelopejs/interface-dms/base/chart-card";
import { Grid, GridRow } from "@antelopejs/interface-dms/base/grid";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { StatGroup } from "@antelopejs/interface-dms/base/stat-group";
import { Tab } from "@antelopejs/interface-dms/base/tab";
import { TopListCard } from "@antelopejs/interface-dms/base/top-list-card";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { getConfig } from "@/config";
import { apiBlock } from "./blocks";
import { exploreCategory } from "./module";
import { liveControl, pageToolbar } from "./live";
import { requestTable } from "./request-table";
import { scopeChip } from "./scope-chip";

const ROUTES_API = "/api/monitoring/routes";
const DETAIL_URL = `${ROUTES_API}/detail`;

/** Scope of the period the Statistics tab follows, set by `PeriodWindow`. */
const ROUTES_PERIOD = "api-routes";

/** Query parameter holding the selected route, as `METHOD /path`. */
const ROUTE_QUERY_KEY = "route";

/**
 * Query parameter holding the open tab. The DMS Tab writes its index, not
 * its slot (`?tab=2` for the tester), and reads nothing else back: named
 * tabs wait for the DMS (DMS-9, `Tab.vue` and `useTab.ts`).
 */
const TAB_QUERY_KEY = "tab";
const TESTER_TAB = "2";

/** A route statistic of the page's period, read for the route the URL names. */
function statisticsUrl(name: string): string {
  return `${ROUTES_API}/statistics/${name}?route={{query.${ROUTE_QUERY_KEY}}}`;
}

const RECENT_REQUESTS = 6;
const MS_PER_SECOND = 1000;

/**
 * The page's period when neither its URL (`?window=`) nor the period kept for
 * the session names one: the last 24 hours, as on the Overview and the logs.
 */
export const ROUTES_DEFAULT_WINDOW = "24h";

/** Narrowest a chart stays readable at beside the other one. */
const CHART_MIN_WIDTH = "340px";

/**
 * The legend ApexCharts draws itself, which a DMS ChartCard turns off in the
 * chart it wraps: without it, nothing says which line is which.
 */
const CHART_LEGEND = {
  key: "legend",
  value: JSON.stringify({
    show: true,
    position: "top",
    horizontalAlign: "right",
    fontSize: "12px",
    labels: { colors: "var(--ui-text-muted)" },
    markers: { size: 5, shape: "square", strokeWidth: 0 },
    itemMargin: { horizontal: 8 },
  }),
};

/** A row of the Statistics tab's grid holding one block, as wide as the tab. */
const FULL_WIDTH = { colSpan: 2 };

/**
 * Calls, latency with its p95, error rate and slowest call of the route over
 * the page's period, as one DMS StatGroup strip. A route without a call over
 * the period answers no figure: the strip says so, and where to call it.
 */
function summaryRow() {
  return GridRow()
    .child(
      "summary",
      StatGroup({
        fetchUrl: statisticsUrl("summary"),
        periodScope: ROUTES_PERIOD,
        layout: "joined",
        columns: 4,
        skeletonCount: 4,
        label: "$api.routes.statistics.title",
        empty: {
          title: "$api.routes.statistics.idle_title",
          description: "$api.routes.statistics.idle_description",
        },
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
    rawOptions: [CHART_LEGEND, LATENCY_MARKERS],
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
        periodScope: ROUTES_PERIOD,
        valueFormat: "percent",
        valuePrecision: 1,
        // A rate's change in points, bad when up: the DMS badge would show it
        // as a relative change, green. The "vs" figure stays (DMS-12).
        showDelta: false,
        showLegend: true,
        // 4xx and 5xx as a share of each bucket's calls: an incident reads
        // whatever the volume around it.
        chart: ChartLine({
          height: "220px",
          xaxisType: "datetime",
          curve: "straight",
          color: ["warning", "error"],
          rawOptions: [CHART_LEGEND],
        }),
      }),
    )
    .child(
      "latency",
      ChartCard({
        title: "$api.routes.statistics.response_time",
        icon: "i-ph-timer",
        fetchUrl: statisticsUrl("latency-chart"),
        periodScope: ROUTES_PERIOD,
        valueFormat: "number",
        // Whole milliseconds: the axis spreads its ticks evenly between the
        // bounds autoYRange widens to the threshold, fractions otherwise
        // ("881.664"). The threshold keeps the range wide enough for whole
        // numbers never to repeat.
        valuePrecision: 0,
        showDelta: false,
        showLegend: true,
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
        periodScope: ROUTES_PERIOD,
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

/**
 * The latest requests of the route over the page's period: a DMS table
 * follows no period scope, but `PeriodWindow` writes `?window=` through the
 * router, which the table reads as a filter. Without one in the URL, its
 * route applies the page's default.
 */
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
 * charts side by side, the rest across.
 */
function routeStatistics() {
  return Grid({ gap: "1rem", minColumnWidth: CHART_MIN_WIDTH })
    .child("summary", summaryRow())
    .child("charts", chartRow())
    .child("detail", errorRow())
    .child("recent", recentRow())
    .meta({ name: "$api.routes.statistics.title", icon: "i-ph-chart-bar" });
}

/**
 * Routes: every registered route in a list, the selected one beside it (under
 * it on a phone) with its statistics, its contract and a tester. The route
 * and the tab live in the URL, so both can be linked to, and so does the
 * period (`?window=24h`, through `PeriodWindow`: the DMS PeriodSelector keeps
 * its own in memory). The tabs wait for a route that exists.
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
  // The toolbar of every monitoring page (`pageToolbar`).
  static toolbar = pageToolbar({
    scope: scopeChip(),
    live: liveControl({
      page: "routes",
      sinceUrl: "/api/monitoring/logs/routes/since",
      defaultWindow: ROUTES_DEFAULT_WINDOW,
      routeKey: ROUTE_QUERY_KEY,
    }),
    period: apiBlock("PeriodWindow", {
      scope: ROUTES_PERIOD,
      defaultWindow: ROUTES_DEFAULT_WINDOW,
    }),
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
      }),
      { slot: "aside" },
    )
    .child(
      "header",
      apiBlock("RouteHeader", {
        fetchUrl: DETAIL_URL,
        queryKey: ROUTE_QUERY_KEY,
        tabKey: TAB_QUERY_KEY,
        testerTab: TESTER_TAB,
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
            // A Tab badge is drawn as written, untranslated: the label says
            // Beta (DMS-9).
            label: "$api.routes.tabs.documentation_beta",
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
        stateKey: TAB_QUERY_KEY,
      })
        .child("statistics", routeStatistics(), { slot: "statistics" })
        .child(
          "documentation",
          apiBlock("RouteDocumentation", {
            fetchUrl: DETAIL_URL,
            queryKey: ROUTE_QUERY_KEY,
          }),
          { slot: "documentation" },
        )
        .child(
          "tester",
          apiBlock("RouteTester", {
            fetchUrl: DETAIL_URL,
            queryKey: ROUTE_QUERY_KEY,
          }),
          { slot: "tester" },
        )
        .meta({ name: "$api.routes.tabs.name", icon: "i-ph-tabs" }),
      // Shown once the URL names a route that exists.
      { slot: "route" },
    )
    .meta({ name: "$api.routes.explorer", icon: "i-ph-tree-structure" });
}
