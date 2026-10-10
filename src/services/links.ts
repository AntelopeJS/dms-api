/**
 * Links between the console's pages. Every drill-down the design asks for
 * ("View 14 server errors", "Open route", "Same error") is a URL, so it can be
 * shared, reloaded and opened in a new tab.
 */

const MODULE_BASE = "/modules/api";

/** Key of the request table on the logs page: its URL parameters carry it. */
const LOGS_TABLE_KEY = "requests";

/** Status-class tabs of the request table, as their ids. */
export type StatusTab = "2xx" | "4xx" | "5xx";

export interface LogsLinkOptions {
  /** `METHOD /path` of a route. */
  route?: string;
  tab?: StatusTab;
  /** An error message the requests must carry. */
  error?: string;
  slow?: boolean;
}

function withQuery(path: string, query: Record<string, string>): string {
  const search = new URLSearchParams(query).toString();
  return search ? `${path}?${search}` : path;
}

/** `METHOD /path`: how a route is named in a URL. */
export function routeRef(method: string, uri: string): string {
  return `${method.toUpperCase()} ${uri}`;
}

export function settingsLink(): string {
  return `${MODULE_BASE}/settings`;
}

export function logsLink(options: LogsLinkOptions = {}): string {
  const query: Record<string, string> = {};
  if (options.route) query.route = options.route;
  if (options.error) query.error = options.error;
  if (options.slow) query.slow = "true";
  if (options.tab) query[`${LOGS_TABLE_KEY}.tab`] = options.tab;
  return withQuery(`${MODULE_BASE}/logs`, query);
}

export function routeLink(route: string, tab?: string): string {
  return withQuery(`${MODULE_BASE}/routes`, tab ? { route, tab } : { route });
}

export function routesLink(): string {
  return `${MODULE_BASE}/routes`;
}
