import { getConfig } from "@/config";
import type { RequestLogModel } from "@/db";
import type {
  RequestLogFilters,
  RequestLogSortKey,
  RequestLogStatusClass,
} from "@/db/models/request_log.model";
import type { RequestLog } from "@/db/tables/request_log.table";
import { MS_PER_DAY, MS_PER_HOUR } from "@/types";
import { routeRef } from "../links";
import { getMaxLogDays } from "../period";
import { parseRouteRef } from "../route-catalog";

/**
 * The list query a `TableView.fromSource` table sends its route: `offset` /
 * `limit`, `sortKey` / `sortDirection`, `search` and one
 * `filter_<column>=<mode>:<value>` per filtered column.
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
  responseTimeMs: number;
  slow: boolean;
  error: string | null;
  ip: string | null;
}

/** Period quick filter values, as the request table offers them. */
export const LOG_WINDOWS = ["1h", "24h", "7d", "14d"] as const;
export type LogWindow = (typeof LOG_WINDOWS)[number];

const WINDOW_MS: Record<LogWindow, number> = {
  "1h": MS_PER_HOUR,
  "24h": MS_PER_DAY,
  "7d": 7 * MS_PER_DAY,
  "14d": 14 * MS_PER_DAY,
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

/** `is:GET` → `GET`; `include:GET,POST` → `GET` (one method at a time). */
export function filterValue(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const separator = raw.indexOf(":");
  const value = separator < 0 ? raw : raw.slice(separator + 1);
  return value.split(",")[0]?.trim() || undefined;
}

export function statusClassOf(status: number): string {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  return "2xx";
}

function windowSince(raw: string | undefined, now: Date): Date | undefined {
  const window = filterValue(raw) as LogWindow | undefined;
  if (!window || !(window in WINDOW_MS)) return undefined;
  const ms = Math.min(WINDOW_MS[window], getMaxLogDays() * MS_PER_DAY);
  return new Date(now.getTime() - ms);
}

function positiveInt(raw: string | undefined): number | undefined {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
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
  const method = filterValue(query.filter_method);
  if (method) filters.method = method;
  if (filterValue(query.filter_slow) === "true") {
    filters.slowThresholdMs = getConfig().requestSlownessThreshold;
  }
  const route = parseRouteRef(filterValue(query.filter_route));
  if (route) {
    filters.method = route.method;
    filters.uri = route.path;
  }
  const error = query.filter_error?.replace(/^[a-z_]+:/, "");
  if (error) filters.errorMessage = error;
  const since = windowSince(query.filter_window, now);
  if (since) filters.since = since;
  const search = query.search?.trim();
  if (search) filters.search = search;
  return filters;
}

export function toRow(log: RequestLog): RequestLogRow {
  return {
    _id: log._id,
    timestamp: log.timestamp.toISOString(),
    method: log.method,
    path: log.rawPath,
    route: routeRef(log.method, log.uri),
    status: String(log.statusCode),
    statusClass: statusClassOf(log.statusCode),
    responseTimeMs: Math.round(log.responseTimeMs),
    slow: log.responseTimeMs >= getConfig().requestSlownessThreshold,
    error: log.error?.message ?? null,
    ip: log.ip ?? null,
  };
}

/** One page of the request table, scoped and filtered. */
export async function listRequestLogs(
  model: RequestLogModel,
  query: SourceQuery,
  keys: Set<string> | null,
): Promise<{ results: RequestLogRow[]; total: number }> {
  if (keys && keys.size === 0) return { results: [], total: 0 };
  const filters = filtersFromQuery(query);
  if (keys) filters.routeKeys = [...keys];
  const page = await model.list(filters, {
    offset: positiveInt(query.offset),
    limit: positiveInt(query.limit) || DEFAULT_PAGE_SIZE,
    sortKey: SORT_KEYS[query.sortKey ?? ""],
    sortDirection: query.sortDirection === "asc" ? "asc" : "desc",
  });
  return { results: page.results.map(toRow), total: page.total };
}
