import { getRegisteredRouteHandlers } from "@antelopejs/interface-api";
import { normalizeRoutePath } from "@/db/tables/routes_statistics.table";
import { INTERNAL_PATH_PREFIXES, INTERNAL_ROUTE_SUFFIX } from "@/types";

/**
 * Traffic the console leaves out entirely, neither logged nor counted: its
 * own endpoints, the DMS's, and the page layouts the DMS frontend loads (see
 * `INTERNAL_PATH_PREFIXES`).
 */
export function isInternalTraffic(rawPath: string, location?: string): boolean {
  return (
    INTERNAL_PATH_PREFIXES.some(
      (prefix) => rawPath === prefix || rawPath.startsWith(`${prefix}/`),
    ) || isPageLayoutPath(location ?? rawPath)
  );
}

/**
 * Whether a route path is the layout the DMS registers for a page
 * (`<page>/pagelayout`, see `INTERNAL_ROUTE_SUFFIX`): plumbing of the
 * console, neither captured nor listed with the API's routes.
 */
export function isPageLayoutPath(path: string): boolean {
  return normalizeRoutePath(path).endsWith(INTERNAL_ROUTE_SUFFIX);
}

/**
 * Calls the DMS console makes by itself, on every page or on a timer: the
 * session check and its refresh, the onboarding and system state, the
 * notification badge. The console's plumbing, not the API's traffic, like
 * `/api/monitoring`. Exact paths, and only on the DMS's own handler: an
 * application route on the same path stays captured.
 */
export const DMS_CONSOLE_PATHS: readonly string[] = [
  "/api/auth/me",
  "/api/auth/refresh",
  "/api/onboarding/informations",
  "/api/system-state",
  "/settings/user/notifications/counts",
];

/**
 * Where the DMS's own console endpoints live: its Settings pages (profile,
 * security, notifications, members, roles…) and the tables they list
 * (members, roles, invites). Left out only on the DMS's own handlers: an
 * application route under the same prefix, a table of its own included,
 * stays captured.
 */
export const DMS_CONSOLE_PATH_PREFIXES: readonly string[] = [
  "/settings",
  "/api/tables",
];

function underDmsConsolePrefix(path: string): boolean {
  return DMS_CONSOLE_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * Where the DMS console's pages live. A client other than a browser (a
 * script, a link preview) loading one gets it through the DMS frontend,
 * which asks the backend first for anything but an HTML visit, then renders
 * the page itself: no handler answers these requests, and they are the
 * console's, not the API's. `/` is the console's home, exactly.
 */
export const DMS_CONSOLE_PAGE_PREFIXES: readonly string[] = [
  "/auth",
  "/home",
  "/modules",
  "/onboarding",
  "/settings",
];

/** The methods a page is loaded with. */
const PAGE_METHODS = new Set(["GET", "HEAD"]);

/**
 * Whether an unanswered request loads a DMS console page (see
 * `DMS_CONSOLE_PAGE_PREFIXES`). Only ever asked for a request no handler
 * matched: an application route on the same path stays captured.
 */
export function isDmsConsolePage(method: string, rawPath: string): boolean {
  if (!PAGE_METHODS.has(method.toUpperCase())) return false;
  const path = normalizeRoutePath(rawPath);
  return (
    path === "/" ||
    DMS_CONSOLE_PAGE_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    )
  );
}

/** Prefix of the DMS's own endpoints: the module behind them is the DMS. */
const DMS_ENDPOINT_PREFIX = "/dms/";

/** A registered handler, as far as telling its module goes. */
export interface HandlerOwner {
  location: string;
  /** Module that registered it, when interface-api could tell. */
  module?: string;
}

/** The module the DMS runs as, read from the handlers of its `/dms/*` endpoints. */
export function dmsModuleOf(
  handlers: readonly HandlerOwner[],
): string | undefined {
  return handlers.find(
    (handler) =>
      handler.module && handler.location.startsWith(DMS_ENDPOINT_PREFIX),
  )?.module;
}

/**
 * Whether a handler answers one of the DMS console's own calls: a path of
 * `DMS_CONSOLE_PATHS`, or any path under `DMS_CONSOLE_PATH_PREFIXES`. Its
 * module must be the DMS's. For an exact path, when the modules cannot be
 * told apart (none recorded), the path decides; under a prefix, which an
 * application may use too, the module must be known to be the DMS's.
 * `handlers` is only read for a path of the list or under a prefix.
 */
export function isDmsConsoleCall(
  handler: HandlerOwner,
  handlers: () => readonly HandlerOwner[] = registeredHandlers,
): boolean {
  const path = normalizeRoutePath(handler.location);
  if (DMS_CONSOLE_PATHS.includes(path)) {
    const dms = dmsModuleOf(handlers());
    return !handler.module || !dms || handler.module === dms;
  }
  if (!underDmsConsolePrefix(path) || !handler.module) return false;
  return handler.module === dmsModuleOf(handlers());
}

/** Every registered handler answering requests, with its module. */
function registeredHandlers(): HandlerOwner[] {
  return getRegisteredRouteHandlers()
    .filter(({ handler }) => handler.mode === "handler")
    .map(({ handler }) => ({
      location: handler.location,
      module: handler.module,
    }));
}
