import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import {
  DefaultDisplays,
  type QueryParamFilters,
  TableView,
  type TableViewSourceColumn,
  type TableViewSourceOptions,
} from "@antelopejs/interface-dms/base/table-view";
import type { DrawerTargetOptions } from "@antelopejs/interface-dms/base/types/action-target";
import type { CustomRowAction } from "@antelopejs/interface-dms/base/types/row-action";
import type { ComponentBuilder } from "@antelopejs/interface-dms/component";
import { LIVE_REQUESTS_TOPIC } from "@/types";
import { apiBlock } from "./blocks";
import { PERIOD_SCOPE } from "@/services/window";
import { PathDisplay, TimeDisplay } from "./displays";

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

/**
 * Every column a request table may show, keyed by row field. None is
 * filterable from the table's own Filters panel: the pages filter through
 * their URL (`QUERY_PARAM_FILTERS`, the logs page's own), which a filter kept
 * by the table in a cookie would override.
 *
 * A size is the least a column gets, its header readable with its sort and
 * menu buttons; the table spreads the room left in proportion. The columns
 * of the request logs fit the 865 px a 1 280 px screen leaves them, beside
 * the row's action, which the DMS keeps pinned to the right. Status and
 * duration come right after the time: with the request panel docked, the
 * table shows its first 450 px or so. The path takes the room left; the
 * request ID, which the panel and the search hold too, is hidden until the
 * column menu shows it.
 */
const REQUEST_COLUMNS: Record<string, TableViewSourceColumn> = {
  timestamp: {
    name: "$api.logs.columns.time",
    type: new DefaultDataTypes.DateType(),
    display: new TimeDisplay({ milliseconds: true }),
    sortable: true,
    size: 140,
    order: 1,
  },
  status: {
    name: "$api.logs.columns.status",
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.StatusPillDisplay({ toneField: "statusTone" }),
    sortable: true,
    size: 116,
    order: 2,
  },
  responseTimeMs: {
    name: "$api.logs.columns.duration",
    type: new DefaultDataTypes.NumberType(),
    // "2 149 ms" on every row, orange when slow (`durationTone`).
    display: new DefaultDisplays.DurationDisplay({
      format: "ms",
      toneField: "durationTone",
    }),
    sortable: true,
    size: 132,
    order: 3,
  },
  method: {
    name: "$api.logs.columns.method",
    type: select(HTTP_METHODS),
    display: new DefaultDisplays.StatusPillDisplay({ tones: METHOD_TONES }),
    filterable: false,
    size: 104,
    order: 4,
  },
  path: {
    name: "$api.logs.columns.path",
    type: new DefaultDataTypes.StringType(),
    // "Tester" beside the path of a request the Tester sent.
    display: new PathDisplay(),
    filterable: false,
    size: 160,
    order: 5,
  },
  // The message is what a 4xx or a 5xx is about: shown, and searched. Keyed
  // `message`, not `error`: the table preferences of earlier versions kept
  // the `error` column hidden, and the DMS keeps a column's visibility once
  // seen, so the column under a new key shows for everyone. `?error=` needs
  // no column: the URL filter goes to the route as it is.
  message: {
    name: "$api.logs.columns.error",
    type: new DefaultDataTypes.StringType(),
    // In red (`errorTone`), like the error of the request panel.
    display: new DefaultDisplays.TextDisplay({ toneField: "errorTone" }),
    filterable: false,
    size: 140,
    order: 6,
  },
  _id: {
    name: "$api.logs.columns.request_id",
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.MonoDisplay({ copy: true }),
    isVisible: false,
    size: 128,
    order: 7,
  },
  statusClass: {
    name: "$api.logs.columns.status_class",
    type: select(STATUS_CLASSES),
    isVisible: false,
    filterable: false,
    order: 8,
  },
  slow: {
    name: "$api.logs.columns.slow",
    type: new DefaultDataTypes.BooleanType(),
    isVisible: false,
    filterable: false,
    order: 9,
  },
  route: {
    name: "$api.logs.columns.route",
    type: new DefaultDataTypes.StringType(),
    isVisible: false,
    filterable: false,
    order: 10,
  },
};

/**
 * Columns a table keeps, hidden, when its page does not show them: the tabs
 * and the URL filter on them.
 */
const FILTER_COLUMNS = new Set(["method", "statusClass", "slow", "route"]);

/** The console pages holding a request table. */
export type RequestTablePage = "logs" | "overview" | "routes";

/**
 * Where each page's table reads one request: the list's own route, by the
 * same permission, so the panel opens wherever the rows show.
 */
const DETAIL_URLS: Record<RequestTablePage, string> = {
  logs: REQUEST_LOGS_URL,
  overview: `${REQUEST_LOGS_URL}/recent`,
  routes: `${REQUEST_LOGS_URL}/routes`,
};

/**
 * Opens a request of the table in a DMS drawer on the right, on a single
 * click: the DMS draws its header (the row's "POST /api/orders", its
 * default "3 of 26,120" over the whole table, in the locale's digits, ∧ ∨,
 * J / K, close), keeps the open row in the URL
 * (`?record=`), and says so when a `?record=` names a request no longer
 * stored; `RequestDetail` draws the request. The drawer opens at the DMS's
 * default width, and at the width the user last left it.
 */
function requestPanelAction(page: RequestTablePage): CustomRowAction {
  return {
    label: "$api.logs.open_request",
    icon: "i-ph-sidebar-simple",
    isVisible: true,
    isDefault: true,
    target: {
      type: "drawer",
      direction: "right",
      component: apiBlock("RequestDetail", { detailUrl: DETAIL_URLS[page] }),
      title: "$api.logs.drawer_title",
      ...REQUEST_DRAWER,
    },
  };
}

/**
 * The drawer options of the request target, typed on their own against the
 * DMS (AntelopeJS/dms#375): an interface without them fails the typecheck
 * here, where the action's union would accept them silently.
 */
const REQUEST_DRAWER: DrawerTargetOptions = {
  rowTitle: "$api.request.heading",
  // On by default for a side panel, off for a drawer.
  deepLink: true,
  notFound: {
    title: "$api.request.not_found_title",
    description: "$api.request.not_found_description",
  },
};

/**
 * Query parameters another page links to the request table with, sent to
 * the route as hidden `filter_<field>` filters. The logs page declares its
 * own set.
 */
const QUERY_PARAM_FILTERS: QueryParamFilters = {
  route: { field: "route", mode: "is" },
  error: { field: "error", mode: "is" },
  slow: { field: "slow", mode: "is" },
};

type RequestTableOptions = Omit<
  TableViewSourceOptions,
  "columns" | "fetchUrl" | "capabilities" | "rowActions"
> & {
  /** The page the table is on: its rows open their request over it. */
  page: RequestTablePage;
  /** Visible columns, by row field, in their order; every shown column when left out. */
  columns?: string[];
  /** Column widths in px, for a table narrower than the logs page's. */
  sizes?: Record<string, number>;
  /** Route answering the rows, when not the request logs page's own. */
  fetchUrl?: string;
};

/**
 * A table over the captured requests, over the page's period. The route
 * pages, searches, sorts and filters on the server; a row opens its request
 * in a drawer. `?route=`,
 * `?error=` and `?slow=` in the page URL filter it on arrival, so another
 * page can link to "the 5xx of this route".
 */
export function requestTable(
  options: RequestTableOptions,
): ComponentBuilder<unknown> {
  const {
    page,
    columns,
    sizes,
    fetchUrl = REQUEST_LOGS_URL,
    liveHold,
    queryParamFilters = QUERY_PARAM_FILTERS,
    ...rest
  } = options;
  const picked = Object.fromEntries(
    Object.entries(REQUEST_COLUMNS)
      .filter(
        ([key]) => !columns || columns.includes(key) || FILTER_COLUMNS.has(key),
      )
      .map(([key, column]) => {
        // A page's columns come in its order (status and duration first on
        // a narrow card), the ones it hides after them.
        const index = columns?.indexOf(key) ?? -1;
        const order = columns
          ? index >= 0
            ? index + 1
            : columns.length + (column.order ?? 0)
          : column.order;
        return [
          key,
          {
            ...column,
            order,
            ...(columns && index < 0 && { isVisible: false }),
            ...(sizes?.[key] && { size: sizes[key] }),
          },
        ];
      }),
  );
  return TableView.fromSource({
    ...rest,
    columns: picked,
    fetchUrl,
    rowIdKey: "_id",
    // Read again on the live feed, and held while the page is paused ("12
    // new requests · Show"): the route lists the rows as they stood
    // (`liveHeldAt`).
    // A request open holds the table alone, the page staying live; the
    // request logs also hold it while scrolled down.
    realtimeTopic: LIVE_REQUESTS_TOPIC,
    liveHold: liveHold ?? {
      whileRowOpen: true,
      missedLabel: "$api.live_mode.new_requests",
    },
    rowClick: "single",
    // A `?record=` beyond the rows listed (a link, an older request).
    fetchRowUrl: `${DETAIL_URLS[page]}/{{row.id}}`,
    capabilities: { search: true, sort: true, paginate: true, filter: true },
    // The page's period, as its charts read it (`preset`, `from`, `to`).
    periodScope: PERIOD_SCOPE,
    rowActions: { custom: [requestPanelAction(page)] },
    // How a link narrows the table: `?route=` sends `filter_route=is:…`.
    queryParamFilters,
  });
}
