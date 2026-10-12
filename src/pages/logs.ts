import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { getConfig } from "@/config";
import { apiBlock } from "./blocks";
import { monitorCategory } from "./module";
import { periodSelector } from "./period";
import { liveMode, pageToolbar } from "./toolbar";
import { requestTable } from "./request-table";
import { scopeChip } from "./scope-chip";

const LOGS_PAGE_SIZE = 50;

/**
 * The page's filters, read from its URL by the request table: a link sets
 * them (`?route=`, `?path=`, `?error=`, `?slow=`), the filters bar changes
 * them (`?method=`, `?slow=`). The period is the toolbar's selector's
 * (`periodScope`): its "All time" is every request kept, and an incident's
 * range is a range of the selector's own (`?api.from=` / `?api.to=`).
 * Unlike the table's own quick filters, kept in a cookie, they are one state
 * that a reload, Back and a shared link keep, and that the tab counts
 * follow. A URL filter needs no column: the table sends it to the route as
 * `filter_<field>`.
 */
const LOGS_QUERY_FILTERS = {
  route: { field: "route", mode: "is" },
  path: { field: "path", mode: "is" },
  error: { field: "error", mode: "is" },
  slow: { field: "slow", mode: "is" },
  method: { field: "method", mode: "is" },
};

/** Draws every empty state of the request table, naming its cause. */
const emptyState = apiBlock("LogsEmptyState");

/**
 * Request logs: every captured request, newest first. Filter by period,
 * status class, method, slowness, route or error, search a path, a request
 * id or an error, then open a request to see its error, timing, headers and
 * bodies.
 */
@RegisterPage()
export class LogsPage extends PageController(
  "logs",
  {
    displayName: "$api.logs.title",
    description: "$api.logs.description",
    icon: "i-ph-list-magnifying-glass",
    module: "api",
    category: monitorCategory,
    order: 1,
    // Direct / Pause over the live feed, each block read at most every 5 s.
    live: liveMode(5),
  },
  DefaultLayout(),
) {
  // The toolbar of every monitoring page (`pageToolbar`): the scope, then
  // the DMS Direct / Pause toggle and the period.
  static toolbar = pageToolbar({
    scope: scopeChip(),
    period: periodSelector({ allTime: true }),
  }).meta({ name: "$api.logs.toolbar", icon: "i-ph-sliders-horizontal" });

  static live = apiBlock<{ fetchUrl: string; maxBodyBytes?: number }>(
    "LiveTraffic",
    { fetchUrl: "/api/monitoring/logs/live" },
  ).onFilter((_permissions, options) => ({
    ...options,
    maxBodyBytes: getConfig().requestLogMaxBodySize,
  }));

  static filters = apiBlock<{ slowThresholdMs?: number }>(
    "LogsFilters",
    {},
  ).onFilter((_permissions, options) => ({
    ...options,
    slowThresholdMs: getConfig().requestSlownessThreshold,
  }));

  // Named like `LOGS_TABLE_KEY`: links put the table's tab under this key.
  static requests = requestTable({
    page: "logs",
    searchPlaceholder: "$api.logs.search",
    // "/" opens the search, in place of the DMS default ⇧F.
    searchShortcut: "/",
    pageSize: LOGS_PAGE_SIZE,
    pagination: "loadMore",
    density: "compact",
    // Held while a request is open or the rows are read further down: new
    // ones would push them away.
    liveHold: { whileRowOpen: true, whileScrolled: true },
    defaultSort: { field: "timestamp", desc: true },
    tabs: [
      {
        id: "2xx",
        label: "2xx",
        filter: { accessorKey: "statusClass", mode: "is", value: "2xx" },
      },
      {
        id: "4xx",
        label: "4xx",
        filter: { accessorKey: "statusClass", mode: "is", value: "4xx" },
      },
      {
        id: "5xx",
        label: "5xx",
        filter: { accessorKey: "statusClass", mode: "is", value: "5xx" },
      },
    ],
    footer: {
      countLabel: "$api.logs.count",
      hint: "$api.logs.keys_hint",
    },
    emptyStates: {
      firstRun: {
        title: "$api.logs.empty.first_run_title",
        component: emptyState,
      },
      filtered: {
        title: "$api.logs.empty.filtered_title",
        component: emptyState,
      },
      error: {
        title: "$api.logs.empty.error_title",
        component: emptyState,
      },
    },
  })
    .mergeOptions({ queryParamFilters: LOGS_QUERY_FILTERS } as Record<
      string,
      unknown
    >)
    .meta({ name: "$api.logs.table", icon: "i-ph-list-magnifying-glass" });
}
