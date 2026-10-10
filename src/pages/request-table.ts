import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import {
  DefaultDisplays,
  TableView,
  type TableViewSourceColumn,
  type TableViewSourceOptions,
} from "@antelopejs/interface-dms/base/table-view";
import type { ComponentBuilder } from "@antelopejs/interface-dms/component";
import { LOG_WINDOWS } from "@/services/request-log/list";
import { apiBlock } from "./blocks";
import { TimeDisplay } from "./displays";

/** Route answering the request tables, in the `TableView.fromSource` shape. */
const REQUEST_LOGS_URL = "/api/monitoring/logs";

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];
const STATUS_CLASSES = ["2xx", "3xx", "4xx", "5xx"];

/** A method drawn in the tone of what it does: read, create, change, delete. */
const METHOD_TONES = {
  GET: "info",
  POST: "success",
  PUT: "warning",
  PATCH: "warning",
  DELETE: "error",
} as const;

function select(values: readonly string[], labelKey?: string) {
  return new DefaultDataTypes.SelectType({
    items: values.map((value) => ({
      value,
      label: labelKey ? `${labelKey}.${value}` : value,
    })),
  });
}

/** Every column a request table may show, keyed by row field. */
const REQUEST_COLUMNS: Record<string, TableViewSourceColumn> = {
  timestamp: {
    name: "$api.logs.columns.time",
    type: new DefaultDataTypes.DateType(),
    display: new TimeDisplay({ milliseconds: true }),
    sortable: true,
    size: 130,
    order: 1,
  },
  method: {
    name: "$api.logs.columns.method",
    type: select(HTTP_METHODS),
    display: new DefaultDisplays.StatusPillDisplay({ tones: METHOD_TONES }),
    filterable: true,
    size: 96,
    order: 2,
  },
  path: {
    name: "$api.logs.columns.path",
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.MonoDisplay(),
    size: 240,
    order: 3,
  },
  status: {
    name: "$api.logs.columns.status",
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.StatusPillDisplay({ toneField: "statusTone" }),
    sortable: true,
    size: 116,
    order: 4,
  },
  responseTimeMs: {
    name: "$api.logs.columns.duration",
    type: new DefaultDataTypes.NumberType(),
    display: new DefaultDisplays.DurationDisplay(),
    sortable: true,
    size: 124,
    order: 5,
  },
  _id: {
    name: "$api.logs.columns.request_id",
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.MonoDisplay({ copy: true }),
    size: 220,
    order: 6,
  },
  statusClass: {
    name: "$api.logs.columns.status_class",
    type: select(STATUS_CLASSES),
    isVisible: false,
    filterable: true,
    order: 7,
  },
  slow: {
    name: "$api.logs.columns.slow",
    type: new DefaultDataTypes.BooleanType(),
    isVisible: false,
    filterable: true,
    order: 8,
  },
  window: {
    name: "$api.logs.columns.window",
    type: select(LOG_WINDOWS, "$api.logs.windows"),
    isVisible: false,
    filterable: true,
    order: 9,
  },
  route: {
    name: "$api.logs.columns.route",
    type: new DefaultDataTypes.StringType(),
    isVisible: false,
    filterable: true,
    order: 10,
  },
  error: {
    name: "$api.logs.columns.error",
    type: new DefaultDataTypes.StringType(),
    isVisible: false,
    filterable: true,
    order: 11,
  },
};

/** The drawer a request opens in, shared by every request table. */
function requestDrawerAction() {
  return {
    label: "$api.logs.open_request",
    icon: "i-ph-sidebar-simple",
    // Drawn inline: the DMS table runs an `isDefault` action on a double
    // click only, so the row's own button is the one-click way to open it.
    isVisible: true,
    isDefault: true,
    deepLink: true,
    target: {
      type: "drawer" as const,
      direction: "right" as const,
      component: apiBlock("RequestDetail"),
      title: "$api.logs.drawer_title",
    },
  };
}

/** Query parameters another page links to the request table with. */
const QUERY_PARAM_FILTERS = {
  route: { field: "route", mode: "is" },
  error: { field: "error", mode: "is" },
  slow: { field: "slow", mode: "is" },
};

type RequestTableOptions = Omit<
  TableViewSourceOptions,
  "columns" | "fetchUrl" | "capabilities" | "rowActions"
> & {
  /** Visible columns, by row field; every column when left out. */
  columns?: string[];
  /** Column widths in px, for a table narrower than the logs page's. */
  sizes?: Record<string, number>;
  /** Route answering the rows, when not the request logs page's own. */
  fetchUrl?: string;
};

/**
 * A table over the captured requests. The route pages, searches, sorts and
 * filters on the server; a row opens the request drawer. `?route=`,
 * `?error=` and `?slow=` in the page URL filter it on arrival, so another
 * page can link to "the 5xx of this route".
 */
export function requestTable(
  options: RequestTableOptions,
): ComponentBuilder<unknown> {
  const { columns, sizes, fetchUrl = REQUEST_LOGS_URL, ...rest } = options;
  const picked = Object.fromEntries(
    Object.entries(REQUEST_COLUMNS)
      .filter(
        ([key, column]) =>
          !columns || columns.includes(key) || column.isVisible === false,
      )
      .map(([key, column]) => [
        key,
        sizes?.[key] ? { ...column, size: sizes[key] } : column,
      ]),
  );
  return TableView.fromSource({
    ...rest,
    columns: picked,
    fetchUrl,
    rowIdKey: "_id",
    capabilities: { search: true, sort: true, paginate: true, filter: true },
    rowActions: { custom: [requestDrawerAction()] },
  }).mergeOptions({
    // A source table does not take `queryParamFilters` in its options, but
    // its client honours them like any table: they are how a link narrows it.
    queryParamFilters: QUERY_PARAM_FILTERS,
  } as Record<string, unknown>) as ComponentBuilder<unknown>;
}
