/**
 * Links between the console's pages. Every drill-down the design asks for
 * ("View 14 server errors", "Open route", "Same error") is a URL, so it can be
 * shared, reloaded and opened in a new tab.
 */

import { normalizeRoutePath } from "@/db/tables/routes_statistics.table";
import { PERIOD_QUERY_KEY, type TimeRange, type WindowPreset } from "./window";

const MODULE_BASE = "/modules/api";

/** Key of the request table on the logs page: its URL parameters carry it. */
const LOGS_TABLE_KEY = "requests";

/** Status-class tabs of the request table, as their ids. */
export type StatusTab = "2xx" | "4xx" | "5xx";

/** The request table's tab listing every status. */
const ALL_TAB = "all";

/** The page a link to the logs leaves from, which the logs page names. */
export type LinkOrigin = "overview" | "routes";

export interface LogsLinkOptions {
  /** `METHOD /path` of a route. */
  route?: string;
  /** A path exactly as requested (`/api/orders/42`). */
  path?: string;
  tab?: StatusTab;
  /** An error message the requests must carry. */
  error?: string;
  slow?: boolean;
  /**
   * The period the figure that links here was computed over, so the logs
   * open on the same requests: the page's `PeriodSelector` reads it from
   * `?api.period=last-24h`.
   */
  period?: WindowPreset | null;
  /**
   * A range the requests must fall in, `[from, to)`: an incident's requests,
   * not the whole window's. A linked filter (`?since=` / `?until=`, ISO
   * timestamps) within the page's period, which stays the one the user
   * chose: the link names none of its own.
   */
  range?: TimeRange;
  /** Where the link leaves from: "Last 24 hours · from Overview". */
  from?: LinkOrigin;
}

function withQuery(path: string, query: Record<string, string>): string {
  const search = new URLSearchParams(query).toString();
  return search ? `${path}?${search}` : path;
}

/**
 * `METHOD /path`: how a route is named in a URL, by its canonical path (a
 * handler at `/api/orders/` is `GET /api/orders`).
 */
export function routeRef(method: string, uri: string): string {
  return `${method.toUpperCase()} ${normalizeRoutePath(uri)}`;
}

export function settingsLink(): string {
  return `${MODULE_BASE}/settings`;
}

/**
 * A link to the request logs. One that narrows the rows (a route, a path, an
 * error, an incident's range) opens the "All" tab unless it names another:
 * the table would open on the tab kept from the last visit and hide most of
 * what the link names. The table reads its tab from the URL when it mounts,
 * which a link followed in the browser does: the tab has to be in the link.
 */
export function logsLink(options: LogsLinkOptions = {}): string {
  const query: Record<string, string> = {};
  if (options.route) query.route = options.route;
  if (options.path) query.path = options.path;
  if (options.error) query.error = options.error;
  if (options.slow) query.slow = "true";
  if (options.range) {
    query.since = options.range.from.toISOString();
    query.until = options.range.to.toISOString();
  }
  if (options.period) query[PERIOD_QUERY_KEY] = options.period;
  if (options.from) query.from = options.from;
  const narrows =
    options.route || options.path || options.error || options.range;
  const tab = options.tab ?? (narrows ? ALL_TAB : undefined);
  if (tab) query[`${LOGS_TABLE_KEY}.tab`] = tab;
  return withQuery(`${MODULE_BASE}/logs`, query);
}

/** The server errors of the last 24 hours, from the Overview. */
export function serverErrorsLink(): string {
  return logsLink({ tab: "5xx", period: "last-24h", from: "overview" });
}

export function routeLink(
  route: string,
  tab?: string,
  period?: WindowPreset | null,
): string {
  const query: Record<string, string> = { route };
  if (tab) query.tab = tab;
  if (period) query[PERIOD_QUERY_KEY] = period;
  return withQuery(`${MODULE_BASE}/routes`, query);
}

/**
 * Slots of the Routes page's tabs: the DMS Tab keeps its open tab in the URL
 * by its slot (`?tab=tester`), the first one by nothing at all.
 */
export const ROUTE_TABS = {
  statistics: "statistics",
  documentation: "documentation",
  tester: "tester",
} as const;

/** The Tester of a route, ready to call it. */
export function testerLink(route: string): string {
  return routeLink(route, ROUTE_TABS.tester);
}

export function routesLink(): string {
  return `${MODULE_BASE}/routes`;
}
