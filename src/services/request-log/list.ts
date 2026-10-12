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
import { MS_PER_DAY, REQUEST_LOG_LIST_MAX_ROWS } from "@/types";
import { routeRef } from "../links";
import { getMaxLogDays } from "../period";
import { parseRouteRef } from "../route-catalog";
import {
  currentRange,
  DEFAULT_WINDOW,
  isWindowPreset,
  parseDate,
  type TimeRange,
  windowQueryFrom,
} from "../window";

/**
 * The list query a `TableView.fromSource` table sends its route: `offset` /
 * `limit`, `sortKey` / `sortDirection`, `search` and one
 * `filter_<column>=<mode>:<value>` per filtered column (the page's URL
 * filters `?method=`, `?slow=`, `?route=`, `?path=`, `?error=` and an
 * incident's `?since=` / `?until=` reach it that way, in the list and in the
 * tab counts alike). The page's period comes as the charts get it, from its
 * `periodScope`: `preset`, `from`, `to`. `requestId=` finds the request a
 * sender knows and `liveHeldAt` (ISO) bounds a held table to the rows it
 * froze.
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
  /** Tone of the duration: `warning` when slow, none otherwise. */
  durationTone: Tone | null;
  /** The error message. */
  message: string | null;
  /** Tone of the error message: `error` when there is one. */
  errorTone: Tone | null;
  ip: string | null;
  /** `tester` for a request sent from the console's Tester. */
  source: string | null;
  /** The request's own `x-request-id`. */
  requestId: string | null;
}

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

const STATUS_TONES: Record<string, Tone> = {
  "5xx": "error",
  "4xx": "warning",
  "3xx": "info",
  "2xx": "success",
};

function statusToneOf(status: number): Tone {
  return STATUS_TONES[statusClassOf(status)] ?? "neutral";
}

/** `2xx`… of a status, as the tabs and the pills group them. */
export function statusClassOf(status: number): string {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  if (status >= 200) return "2xx";
  return "1xx";
}

function positiveInt(raw: string | undefined): number | undefined {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * The rows the page's period frames, as the charts read it (`preset`, `from`,
 * `to` of its period scope): a rolling preset up to now, the newest rows
 * included, or a custom range; never past the log retention. The DMS "All
 * time" (`preset=all`, no `from` / `to`) lists every request kept, and so
 * does a query naming no period (the Tester's reads).
 */
function periodRange(query: SourceQuery, now: Date): Partial<TimeRange> {
  const window = windowQueryFrom(query);
  const preset = isWindowPreset(window.preset) ? window.preset : null;
  if (!preset && !window.from && !window.to) return {};
  const range = currentRange(window, preset, DEFAULT_WINDOW, now);
  const horizon = new Date(now.getTime() - getMaxLogDays() * MS_PER_DAY);
  return {
    from: range.from < horizon ? horizon : range.from,
    to: preset ? undefined : range.to,
  };
}

/** The log filters a source list query names. */
export function filtersFromQuery(
  query: SourceQuery,
  now: Date = new Date(),
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
  // An incident's range narrows the period, never widens it.
  const range = periodRange(query, now);
  const since = latest(range.from, linkedDate(query.filter_since));
  if (since) filters.since = since;
  const until = earliest(
    range.to,
    heldAt(query),
    linkedDate(query.filter_until),
  );
  if (until) filters.until = until;
  const search = query.search?.trim();
  if (search) filters.search = search;
  const requestId = query.requestId?.trim();
  if (requestId) filters.requestId = requestId;
  return filters;
}

/**
 * `liveHeldAt`: the moment a held table froze its rows (its live page paused).
 * Its search, sort and "Load more" list the rows as they stood then, like the
 * end of a custom range, so nothing that arrived since slips in.
 */
function heldAt(query: SourceQuery): Date | undefined {
  return parseDate(query.liveHeldAt);
}

/** `is:2026-10-10T13:15:00.000Z` → that date: a linked bound, mode aside. */
function linkedDate(raw: string | undefined): Date | undefined {
  return parseDate(raw?.replace(/^[a-z_]+:/, ""));
}

function known(dates: (Date | undefined)[]): number[] {
  return dates
    .filter((date): date is Date => date !== undefined)
    .map((date) => date.getTime());
}

function earliest(...dates: (Date | undefined)[]): Date | undefined {
  const times = known(dates);
  return times.length ? new Date(Math.min(...times)) : undefined;
}

function latest(...dates: (Date | undefined)[]): Date | undefined {
  const times = known(dates);
  return times.length ? new Date(Math.max(...times)) : undefined;
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
  const slow =
    duration !== null && duration >= getConfig().requestSlownessThreshold;
  const message = log.errorMessage ?? null;
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
    slow,
    durationTone: slow ? "warning" : null,
    message,
    errorTone: message ? "error" : null,
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
  const filters = filtersFromQuery(query);
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
