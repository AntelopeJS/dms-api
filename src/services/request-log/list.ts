import type { Tone } from "@antelopejs/interface-dms/base/types/tone";
import { getConfig } from "@/config";
import type { RequestLogModel } from "@/db";
import type {
  RequestLogFilters,
  RequestLogListItem,
  RequestLogSortKey,
  RequestLogStatusClass,
} from "@/db/models/request_log.model";
import { normalizeRoutePath } from "@/db/tables/routes_statistics.table";
import { MS_PER_DAY, MS_PER_HOUR, REQUEST_LOG_LIST_MAX_ROWS } from "@/types";
import { routeRef } from "../links";
import { getMaxLogDays } from "../period";
import { parseRouteRef } from "../route-catalog";

/**
 * The list query a `TableView.fromSource` table sends its route: `offset` /
 * `limit`, `sortKey` / `sortDirection`, `search` and one
 * `filter_<column>=<mode>:<value>` per filtered column (the page's URL
 * filters `?window=`, `?method=`, `?slow=`, `?route=`, `?path=`, `?error=`
 * and an incident's `?since=` / `?until=` reach it that way, in the list and
 * in the tab counts alike). `filter_from` / `filter_to` (ISO timestamps)
 * narrow to `[from, to)`,
 * `requestId=` finds the request a sender knows and, for `/logs/since`,
 * `after=` is the live cursor.
 */
export type SourceQuery = Record<string, string | undefined>;

/** A request as the request table lists it. */
export interface RequestLogRow {
  _id: string;
  timestamp: string;
  method: string;
  path: string;
  route: string;
  status: string;
  statusClass: string;
  /** Tone of the status pill: its class, as the DMS draws tones. */
  statusTone: Tone;
  /**
   * Null when the duration was not measured (the request reached no route).
   * Whole milliseconds, but a request answered within the first one keeps
   * its fraction: a 0.3 ms 413 is not "0 ms".
   */
  responseTimeMs: number | null;
  slow: boolean;
  /**
   * The error message. Not `error`: the column under that key had its
   * visibility kept hidden in the table preferences of earlier versions.
   */
  message: string | null;
  ip: string | null;
  /** `tester` for a request sent from the console's Tester. */
  source: string | null;
  /** The request's own `x-request-id`. */
  requestId: string | null;
}

/** Period quick filter values, as the request table offers them. */
export const LOG_WINDOWS = ["1h", "24h", "7d", "30d"] as const;
export type LogWindow = (typeof LOG_WINDOWS)[number];

const WINDOW_MS: Record<LogWindow, number> = {
  "1h": MS_PER_HOUR,
  "24h": MS_PER_DAY,
  "7d": 7 * MS_PER_DAY,
  "30d": 30 * MS_PER_DAY,
};

const STATUS_CLASS_OF_TAB: Record<string, RequestLogStatusClass> = {
  "2xx": "success",
  "4xx": "client-error",
  "5xx": "server-error",
};

const SORT_KEYS: Record<string, RequestLogSortKey> = {
  timestamp: "timestamp",
  status: "statusCode",
  responseTimeMs: "responseTimeMs",
};

const DEFAULT_PAGE_SIZE = 50;

/** Hundredths of a millisecond: what a sub-millisecond duration keeps. */
const SUB_MS_PRECISION = 100;

/** Default and largest number of rows `/logs/since` answers. */
const SINCE_DEFAULT_LIMIT = 100;
const SINCE_MAX_LIMIT = 500;

/** `is:GET,POST` → `["GET", "POST"]`: the values of a filter, mode aside. */
function filterValues(raw: string | undefined): string[] {
  if (!raw) return [];
  const separator = raw.indexOf(":");
  const value = separator < 0 ? raw : raw.slice(separator + 1);
  return value
    .split(",")
    .map((each) => each.trim())
    .filter(Boolean);
}

/** `is:GET` → `GET`; `include:GET,POST` → `GET` (the first value). */
function filterValue(raw: string | undefined): string | undefined {
  return filterValues(raw)[0];
}

/** `is:<ISO timestamp>` as a date, or undefined when unreadable. */
function filterDate(raw: string | undefined): Date | undefined {
  return parseAfter(raw?.replace(/^[a-z_]+:/, ""));
}

const STATUS_TONES: Record<string, Tone> = {
  "5xx": "error",
  "4xx": "warning",
  "3xx": "info",
  "2xx": "success",
};

function statusToneOf(status: number): Tone {
  return STATUS_TONES[statusClassOf(status)] ?? "neutral";
}

export function statusClassOf(status: number): string {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  return "2xx";
}

/** The period a filter names, when it is one the table offers. */
function readWindow(raw: string | undefined): LogWindow | undefined {
  const window = filterValue(raw);
  return LOG_WINDOWS.find((each) => each === window);
}

function windowSince(window: LogWindow, now: Date): Date {
  const ms = Math.min(WINDOW_MS[window], getMaxLogDays() * MS_PER_DAY);
  return new Date(now.getTime() - ms);
}

function positiveInt(raw: string | undefined): number | undefined {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Where the rows start: `filter_from`, else the period's start. The range
 * frames the rows itself: the period, the page's default one included,
 * would cut an incident older than it.
 */
function periodStart(
  query: SourceQuery,
  now: Date,
  defaultWindow: LogWindow | undefined,
): Date | undefined {
  const from = filterDate(query.filter_from);
  if (from) return from;
  const window = readWindow(query.filter_window) ?? defaultWindow;
  return window ? windowSince(window, now) : undefined;
}

/**
 * The log filters a source list query names. A period it does not name, or
 * names wrong (`?window=14d`), is `defaultWindow`: never no bound at all.
 */
export function filtersFromQuery(
  query: SourceQuery,
  now: Date = new Date(),
  defaultWindow?: LogWindow,
): RequestLogFilters {
  const filters: RequestLogFilters = {};
  const statusClass =
    STATUS_CLASS_OF_TAB[filterValue(query.filter_statusClass) ?? ""];
  if (statusClass) filters.statusClass = statusClass;
  const methods = filterValues(query.filter_method);
  if (methods.length === 1) filters.method = methods[0];
  else if (methods.length > 1) filters.methods = methods;
  if (filterValue(query.filter_slow) === "true") {
    filters.slowThresholdMs = getConfig().requestSlownessThreshold;
  }
  // The route's method, not the request's: a HEAD served by the GET handler
  // stays on its GET route. `GET /api/orders/` and `GET /api/orders` are one
  // route.
  const route = parseRouteRef(filterValue(query.filter_route));
  if (route) {
    filters.routeMethod = route.method;
    filters.uri = normalizeRoutePath(route.path);
  }
  // Whole after the mode, like the error: a path may hold a comma.
  const rawPath = query.filter_path?.replace(/^[a-z_]+:/, "");
  if (rawPath) filters.rawPath = rawPath;
  const error = query.filter_error?.replace(/^[a-z_]+:/, "");
  if (error) filters.errorMessage = error;
  // `filter_from` / `filter_to` (ISO) narrow to a `[from, to)` range: an
  // incident an Activity link names, a minute of the histogram.
  const since = periodStart(query, now, defaultWindow);
  if (since) filters.since = since;
  const until = filterDate(query.filter_to);
  if (until) filters.until = until;
  const search = query.search?.trim();
  if (search) filters.search = search;
  const requestId = query.requestId?.trim();
  if (requestId) filters.requestId = requestId;
  return filters;
}

/**
 * A duration as the table shows it: whole milliseconds, or, under one, its
 * fraction (never 0: a measured duration is never nil, and 0 would read as
 * not measured).
 */
function rowDuration(duration: number | null): number | null {
  if (duration === null) return null;
  if (duration >= 1) return Math.round(duration);
  return Math.max(
    Math.round(duration * SUB_MS_PRECISION) / SUB_MS_PRECISION,
    1 / SUB_MS_PRECISION,
  );
}

/**
 * Whether the query filters on a route it cannot read (`?route=garbage`):
 * no request matches it, rather than every request.
 */
export function namesUnknownRoute(query: SourceQuery): boolean {
  const raw = filterValue(query.filter_route);
  return raw !== undefined && parseRouteRef(raw) === undefined;
}

/** How a request table reads the list, besides its query. */
export interface RequestLogListOptions {
  /** The table's period when the query names none it knows. */
  defaultWindow?: LogWindow;
  /**
   * List nothing until the query names a route (`filter_route`): the tables
   * of the Routes page show the requests of the route it selects, never
   * every request of the API.
   */
  requireRoute?: boolean;
  /**
   * Find a request named by its id (`requestId=`) or its exact path
   * (`filter_path`) whatever the scope: the request logs page, which the
   * request panel links to for a path no route answers. The other tables
   * keep to the scope.
   */
  findOutsideScope?: boolean;
  /** The Tester's requests only: what the Tester finds its calls among. */
  testerOnly?: boolean;
}

/** Whether no request can match: a scope, a route or a missing route. */
function matchesNothing(
  query: SourceQuery,
  scope: Set<string> | null,
  options: RequestLogListOptions,
): boolean {
  if (scope && scope.size === 0) return true;
  if (options.requireRoute && filterValue(query.filter_route) === undefined) {
    return true;
  }
  return namesUnknownRoute(query);
}

export function toRow(log: RequestLogListItem): RequestLogRow {
  const duration = log.responseTimeMs ?? null;
  return {
    _id: log._id,
    timestamp: log.timestamp.toISOString(),
    method: log.method,
    path: log.rawPath,
    route: routeRef(log.routeMethod ?? log.method, log.uri),
    status: String(log.statusCode),
    statusClass: statusClassOf(log.statusCode),
    statusTone: statusToneOf(log.statusCode),
    responseTimeMs: rowDuration(duration),
    slow: duration !== null && duration >= getConfig().requestSlownessThreshold,
    message: log.errorMessage ?? null,
    ip: log.ip ?? null,
    source: log.source ?? null,
    requestId: log.requestId ?? null,
  };
}

/** A page of the request table, as its route answers it. */
export interface RequestLogTablePage {
  results: RequestLogRow[];
  total: number;
}

/** One page of the request table, scoped and filtered. */
export async function listRequestLogs(
  model: Pick<RequestLogModel, "list">,
  query: SourceQuery,
  keys: Set<string> | null,
  options: RequestLogListOptions = {},
): Promise<RequestLogTablePage> {
  const filters = filtersFromQuery(query, new Date(), options.defaultWindow);
  const scope = scopeOf(filters, keys, options);
  if (matchesNothing(query, scope, options)) {
    return { results: [], total: 0 };
  }
  if (scope) filters.routeKeys = [...scope];
  if (options.testerOnly) filters.testerOnly = true;
  const page = await model.list(filters, {
    offset: positiveInt(query.offset),
    limit: Math.min(
      positiveInt(query.limit) || DEFAULT_PAGE_SIZE,
      REQUEST_LOG_LIST_MAX_ROWS,
    ),
    sortKey: SORT_KEYS[query.sortKey ?? ""],
    sortDirection: query.sortDirection === "asc" ? "asc" : "desc",
  });
  return {
    results: page.results.map(toRow),
    total: page.total,
  };
}

/**
 * The scope a listing keeps to. On the request logs page, a request named by
 * its id is found whatever the scope, and so are the requests to one path
 * the panel links to: a path no route answers is in no scope.
 */
function scopeOf(
  filters: RequestLogFilters,
  keys: Set<string> | null,
  options: RequestLogListOptions,
): Set<string> | null {
  const named = filters.requestId || filters.rawPath;
  return options.findOutsideScope && named ? null : keys;
}

/** What arrived since a live view's cursor. */
export interface RequestLogSince {
  /** Newest first, up to `limit`. */
  results: RequestLogRow[];
  /**
   * Every matching API request after the cursor, beyond `limit` too; the
   * Tester's are in `tester`.
   */
  count: number;
  /** Of `count`, the ones answered with a 5xx. */
  serverErrors: number;
  /** Matching requests the Tester sent. */
  tester: number;
  /** The `after` of the next call: the newest request's timestamp. */
  cursor: string;
  /** The server's clock as it answered: a cursor for a view with no row. */
  now: string;
}

/** `after=` as a date, or undefined when missing or unreadable. */
export function parseAfter(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * The requests matching the table's filters that arrived after `after`: what
 * a live view adds on top of the rows it shows, without reloading them.
 */
export async function listRequestLogsSince(
  model: Pick<RequestLogModel, "since">,
  query: SourceQuery,
  after: Date,
  keys: Set<string> | null,
  options: RequestLogListOptions = {},
): Promise<RequestLogSince> {
  const now = new Date().toISOString();
  const filters = filtersFromQuery(query, new Date(), options.defaultWindow);
  const scope = scopeOf(filters, keys, options);
  if (matchesNothing(query, scope, options)) {
    return {
      results: [],
      count: 0,
      serverErrors: 0,
      tester: 0,
      cursor: after.toISOString(),
      now,
    };
  }
  if (scope) filters.routeKeys = [...scope];
  // `limit=0` counts without reading a row.
  const limit = Math.min(
    positiveInt(query.limit) ?? SINCE_DEFAULT_LIMIT,
    SINCE_MAX_LIMIT,
  );
  const page = await model.since(filters, after, limit);
  const newest = page.results[0]?.timestamp;
  return {
    results: page.results.map(toRow),
    count: page.count,
    serverErrors: page.serverErrors,
    tester: page.tester,
    cursor: (newest ?? after).toISOString(),
    now,
  };
}
