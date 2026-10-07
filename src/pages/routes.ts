import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PeriodSelector } from "@antelopejs/interface-dms/base/period-selector";
import { HStack, Spacer } from "@antelopejs/interface-dms/base/stack";
import { Tab } from "@antelopejs/interface-dms/base/tab";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { apiBlock } from "./blocks";
import { exploreCategory } from "./module";
import { scopeChip } from "./scope-chip";

const ROUTES_API = "/api/monitoring/routes";

/** Scope of the period selector the Statistics tab follows. */
const ROUTES_PERIOD = "api-routes";

/** Query parameter holding the selected route, as `METHOD /path`. */
const ROUTE_QUERY_KEY = "route";

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
        .child(
          "statistics",
          apiBlock("RouteStatistics", {
            fetchUrl: `${ROUTES_API}/statistics`,
            queryKey: ROUTE_QUERY_KEY,
            periodScope: ROUTES_PERIOD,
          }),
          { slot: "statistics" },
        )
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
