import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import type { QueryParamFilters } from "@antelopejs/interface-dms/base/table-view";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { getConfig } from "@/config";
import { LIVE_REQUESTS_TOPIC } from "@/types";
import { apiBlock } from "./blocks";
import { monitorCategory } from "./module";
import { liveMode, monitoringToolbar } from "./toolbar";
import { requestTable } from "./request-table";
import { scopeChip } from "./scope-chip";

const LOGS_PAGE_SIZE = 50;

/**
 * The page's filters, read from its URL by the request table: a link sets
 * them (`?route=`, `?path=`, `?error=`, `?slow=`, an incident's
 * `?since=` / `?until=`), the filters bar changes them (`?method=`,
 * `?slow=`). The period is the toolbar's selector's (`periodScope`): its
 * "All time" is every request kept, and an incident's range narrows it
 * without replacing it.
 * Unlike the table's own quick filters, kept in a cookie, they are one state
 * that a reload, Back and a shared link keep, and that the tab counts
 * follow. A URL filter needs no column: the table sends it to the route as
 * `filter_<field>`.
 */
const LOGS_QUERY_FILTERS: QueryParamFilters = {
  route: { field: "route", mode: "is" },
  path: { field: "path", mode: "is" },
  error: { field: "error", mode: "is" },
  slow: { field: "slow", mode: "is" },
  method: { field: "method", mode: "is" },
  since: { field: "since", mode: "is" },
  until: { field: "until", mode: "is" },
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
  // The toolbar of every monitoring page (`monitoringToolbar`): the scope,
  // then the DMS Direct / Pause toggle and the period, with its "All time".
  static toolbar = monitoringToolbar({
    leading: { scope: scopeChip() },
    allTime: true,
  }).meta({ name: "$api.logs.toolbar", icon: "i-ph-sliders-horizontal" });

  static live = apiBlock<{
    fetchUrl: string;
    realtimeTopic: string;
    maxBodyBytes?: number;
  }>("LiveTraffic", {
    fetchUrl: "/api/monitoring/logs/live",
    realtimeTopic: LIVE_REQUESTS_TOPIC,
  }).onFilter((_permissions, options) => ({
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
    // Held while a request is open, the rows are read further down, a search
    // narrows them or they are sorted otherwise than newest first: new ones
    // would push them away or land anywhere. The strip says why ("Table on
    // hold · search active"), and paused, what came in ("40 new requests ·
    // 2 in 5xx", the breakdown `useLiveMissedErrors` gives the page).
    liveHold: {
      whileRowOpen: true,
      whileScrolled: true,
      whileSearching: true,
      whileSorted: true,
      missedLabel: "$api.live_mode.new_requests",
    },
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
    queryParamFilters: LOGS_QUERY_FILTERS,
  }).meta({ name: "$api.logs.table", icon: "i-ph-list-magnifying-glass" });
}
