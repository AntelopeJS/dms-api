import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { apiBlock } from "./blocks";
import { monitorCategory } from "./module";
import { requestTable } from "./request-table";

const LOGS_PAGE_SIZE = 50;

/**
 * Request logs: every captured request, newest first. Filter by status class,
 * method, slowness or period, search a path, a request id or an error, then
 * open a request to see its error, timing, headers and bodies.
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
  },
  DefaultLayout(),
) {
  static live = apiBlock("LiveTraffic", {
    fetchUrl: "/api/monitoring/logs/live",
  });

  // Named like `LOGS_TABLE_KEY`: links put the table's tab under this key.
  static requests = requestTable({
    searchPlaceholder: "$api.logs.search",
    pageSize: LOGS_PAGE_SIZE,
    pagination: "loadMore",
    density: "compact",
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
    quickFilters: [
      {
        field: "window",
        label: "$api.logs.filters.period",
        icon: "i-ph-clock",
      },
      {
        field: "method",
        label: "$api.logs.filters.method",
        icon: "i-ph-funnel",
      },
      { field: "slow", label: "$api.logs.filters.slow", icon: "i-ph-timer" },
    ],
    footer: {
      countLabel: "$api.logs.count",
      hint: "$api.logs.keys_hint",
    },
    emptyStates: {
      firstRun: {
        title: "$api.logs.empty.first_run_title",
        description: "$api.logs.empty.first_run_description",
        icon: "i-ph-broadcast",
        actions: [
          { label: "$api.logs.empty.browse_routes", to: "/modules/api/routes" },
        ],
      },
      filtered: {
        title: "$api.logs.empty.filtered_title",
        description: "$api.logs.empty.filtered_description",
        icon: "i-ph-magnifying-glass",
      },
      error: {
        title: "$api.logs.empty.error_title",
        description: "$api.logs.empty.error_description",
        icon: "i-ph-warning-circle",
      },
    },
  }).meta({ name: "$api.logs.table", icon: "i-ph-list-magnifying-glass" });
}
